/**
 * FIDE Dubov System pairing (C.04.4.1) — weighted blossom matching.
 *
 * Uses maximum-weight matching (Edmonds' blossom algorithm) so that all
 * score groups are handled correctly in a single global pass.
 *
 * Algorithm outline
 * -----------------
 * 1. Build PlayerState for every player.
 * 2. Sort players by Dubov ranking: score DESC, ARO DESC, TPN ASC.
 * 3. Determine the bye assignee when player count is odd.
 * 4. Single global blossom pass:
 *      a. Build edges for all remaining players with full quality weights
 *         (C5–C10). C1 rematches produce zero-weight edges and are skipped.
 *      b. Run blossom with maxcardinality=true to find the optimal matching.
 * 5. Allocate colours for every pair via FIDE Article 5.
 * 6. Assign bye (odd player count) via `assignBye`.
 */

import { maxWeightMatching } from './blossom.js';
import { allocateColor, assignBye, buildPlayerStates } from './utilities.js';
import { buildEdgeWeight } from './weights.js';

import type { DynamicUint } from './dynamic-uint.js';
import type { Game, PairingResult, Player } from './types.js';
import type { ColorRule, PlayerState } from './utilities.js';
import type { BracketContext, Criterion } from './weights.js';

// ---------------------------------------------------------------------------
// ARO computation
// ---------------------------------------------------------------------------

/**
 * Computes Average Rating of Opponents for a player.
 * Returns 0 if no rated games have been played.
 */
function computeARO(state: PlayerState, players: Player[]): number {
  if (state.opponents.size === 0) return 0;
  const ratingById = new Map<string, number>();
  for (const p of players) {
    ratingById.set(p.id, p.rating ?? 0);
  }
  let sum = 0;
  let count = 0;
  for (const oppId of state.opponents) {
    const rating = ratingById.get(oppId) ?? 0;
    sum += rating;
    count++;
  }
  if (count === 0) return 0;
  // Round to nearest integer (higher if 0.5)
  return Math.round(sum / count);
}

// ---------------------------------------------------------------------------
// FIDE Article 5 colour rules
// ---------------------------------------------------------------------------

function rankPreference(s: PlayerState['preferenceStrength']): number {
  if (s === 'absolute') return 3;
  if (s === 'strong') return 2;
  if (s === 'mild') return 1;
  return 0;
}

const DUBOV_COLOR_RULES: ColorRule[] = [
  // 5.2.1 (round 1): Both players have no history — odd TPN gets initial colour (white)
  (hrp, opp) => {
    const hrpHasHistory = hrp.colorHistory.some((c) => c !== undefined);
    const oppHasHistory = opp.colorHistory.some((c) => c !== undefined);
    if (!hrpHasHistory && !oppHasHistory) {
      return hrp.tpn % 2 === 1 ? 'hrp-white' : 'hrp-black';
    }
    return 'continue';
  },
  // 5.2.2 Grant both colour preferences (if they differ)
  (hrp, opp) => {
    if (
      hrp.preferredColor !== undefined &&
      opp.preferredColor !== undefined &&
      hrp.preferredColor !== opp.preferredColor
    ) {
      return hrp.preferredColor === 'white' ? 'hrp-white' : 'hrp-black';
    }
    return 'continue';
  },
  // 5.2.3 Grant stronger preference; both absolute → wider colorDiff wins
  (hrp, opp) => {
    const hrpS = rankPreference(hrp.preferenceStrength);
    const oppS = rankPreference(opp.preferenceStrength);

    if (hrpS > oppS && hrp.preferredColor !== undefined) {
      return hrp.preferredColor === 'white' ? 'hrp-white' : 'hrp-black';
    }
    if (oppS > hrpS && opp.preferredColor !== undefined) {
      return opp.preferredColor === 'white' ? 'hrp-black' : 'hrp-white';
    }
    // Both absolute: wider colorDiff wins
    if (hrpS === 3 && oppS === 3) {
      const hrpAbs = Math.abs(hrp.colorDiff);
      const oppAbs = Math.abs(opp.colorDiff);
      if (hrpAbs > oppAbs && hrp.preferredColor !== undefined) {
        return hrp.preferredColor === 'white' ? 'hrp-white' : 'hrp-black';
      }
      if (oppAbs > hrpAbs && opp.preferredColor !== undefined) {
        return opp.preferredColor === 'white' ? 'hrp-black' : 'hrp-white';
      }
    }
    return 'continue';
  },
  // 5.2.4 Alternate from most recent divergent round
  (hrp, opp) => {
    const minLength = Math.min(
      hrp.colorHistory.length,
      opp.colorHistory.length,
    );
    for (let index = minLength - 1; index >= 0; index--) {
      const h = hrp.colorHistory[index];
      const o = opp.colorHistory[index];
      if (h !== undefined && o !== undefined && h !== o) {
        return h === 'white' ? 'hrp-black' : 'hrp-white';
      }
    }
    return 'continue';
  },
  // 5.2.5 Grant HRP's preference
  (hrp) => {
    if (hrp.preferredColor !== undefined) {
      return hrp.preferredColor === 'white' ? 'hrp-white' : 'hrp-black';
    }
    return 'continue';
  },
];

// Rank comparator for allocateColor: lower TPN = higher rank in Dubov
function dubovRankCompare(a: PlayerState, b: PlayerState): number {
  return a.tpn - b.tpn;
}

// Bye tiebreak:
//   3.1.3 lowest score
//   3.1.4 highest number of games played (fewest unplayed rounds)
//   3.1.5 largest TPN
function dubovByeTiebreak(a: PlayerState, b: PlayerState): number {
  if (a.unplayedRounds !== b.unplayedRounds)
    return a.unplayedRounds - b.unplayedRounds;
  return b.tpn - a.tpn;
}

// ---------------------------------------------------------------------------
// Dubov pairing criteria (C5–C10)
//
// Each criterion returns a NON-NEGATIVE value ∈ [0, 2^bits).
// "Minimize X" is encoded as "maximize (max - X)".
// ---------------------------------------------------------------------------

/**
 * Extended BracketContext for Dubov: includes ranking position map for
 * adjacent-pair criterion encoding.
 */
interface DubovContext extends BracketContext {
  /** Map from player id → rank index (0-based) in Dubov sorted order */
  rankIndex: Map<string, number>;
  /** Total number of players being paired */
  playerCount: number;
  /** MaxT parameter: 2 + floor(totalRounds / 5) */
  maxT: number;
  /** Map from player id → upfloat count (times been upfloated) */
  upfloatCount: Map<string, number>;
  totalRounds: number;
  isLastRound: boolean;
}

const DUBOV_CRITERIA: Criterion[] = [
  // C1 is handled by buildEdgeWeight (zero for rematches).

  // C3: Absolute colour conflict (two players same absolute colour preference must not meet).
  // 1 bit: 1 = no violation
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState) => {
      if (
        a.preferenceStrength === 'absolute' &&
        b.preferenceStrength === 'absolute' &&
        a.preferredColor !== undefined &&
        b.preferredColor !== undefined &&
        a.preferredColor === b.preferredColor
      ) {
        return 0;
      }
      return 1;
    },
  },

  // C5: Minimise the number of upfloaters (i.e. prefer same-score-group pairs).
  // 1 bit: 1 = same score group (no upfloat), 0 = cross-group
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState) => {
      return a.score === b.score ? 1 : 0;
    },
  },

  // C6: Minimise score differences in pairs involving upfloaters.
  // Prefer upfloaters with higher score (smaller diff with their opponent).
  // 8 bits: encode (255 - scoreDiff * 2) for cross-group; 255 for same-group
  {
    bits: 8,
    evaluate: (a: PlayerState, b: PlayerState) => {
      if (a.score === b.score) return 255;
      const scoreDiff = Math.abs(a.score - b.score);
      return Math.max(0, 255 - Math.floor(scoreDiff * 2));
    },
  },

  // C7: Minimise the number of players who do not get their colour preference.
  // 2 bits: encode (3 - violations)
  {
    bits: 2,
    evaluate: (a: PlayerState, b: PlayerState) => {
      let aColor: 'white' | 'black';
      if (a.colorDiff < b.colorDiff) {
        aColor = 'white';
      } else if (a.colorDiff > b.colorDiff) {
        aColor = 'black';
      } else {
        aColor = a.tpn < b.tpn ? 'white' : 'black';
      }
      const bColor = aColor === 'white' ? 'black' : 'white';

      let violations = 0;
      if (a.preferredColor !== undefined && a.preferredColor !== aColor)
        violations++;
      if (b.preferredColor !== undefined && b.preferredColor !== bColor)
        violations++;
      return Math.max(0, 3 - violations);
    },
  },

  // C8: Unless last round, minimise upfloaters who are maximum upfloaters.
  // 1 bit: 1 = no violation (same-group, or neither is a max upfloater)
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DubovContext;
      if (dContext.isLastRound) return 1;
      if (a.score === b.score) return 1;
      const upfloater = a.score < b.score ? a : b;
      const upfloatCt = dContext.upfloatCount.get(upfloater.id) ?? 0;
      return upfloatCt >= dContext.maxT ? 0 : 1;
    },
  },

  // C9: Unless last round, minimise the number of times a max upfloater is upfloated.
  // 4 bits: encode (15 - upfloat penalty)
  {
    bits: 4,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DubovContext;
      if (dContext.isLastRound) return 15;
      if (a.score === b.score) return 15;
      const upfloater = a.score < b.score ? a : b;
      const upfloatCt = dContext.upfloatCount.get(upfloater.id) ?? 0;
      if (upfloatCt >= dContext.maxT) {
        return Math.max(0, 15 - upfloatCt);
      }
      return 15;
    },
  },

  // C10: Unless last round, minimise upfloaters who upfloated in the previous round.
  // 1 bit: 1 = no violation
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DubovContext;
      if (dContext.isLastRound) return 1;
      if (a.score === b.score) return 1;
      const upfloater = a.score < b.score ? a : b;
      return upfloater.floatHistory.at(-1) === 'up' ? 0 : 1;
    },
  },

  // Adjacent-rank preference criterion for round 1 (and generally).
  // Dubov pairs by adjacent ranking: rank 0 with rank 1, rank 2 with rank 3, etc.
  // For a pair (i, j) with i < j:
  //   - Perfect adjacent pair (i even, j = i+1): max score
  //   - Closer in rank → higher score
  // This naturally encodes adjacent pairing in the blossom weight.
  // bits = ceil(log2(playerCount + 1)), at least 4
  {
    bits: (context: BracketContext) => {
      const dContext = context as DubovContext;
      return Math.max(4, Math.ceil(Math.log2(dContext.playerCount + 2)));
    },
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DubovContext;
      const n = dContext.playerCount;
      const maxScore = Math.max(4, Math.ceil(Math.log2(n + 2)));
      const maxValue = (1 << maxScore) - 1;

      const rankA = dContext.rankIndex.get(a.id);
      const rankB = dContext.rankIndex.get(b.id);
      if (rankA === undefined || rankB === undefined) return 0;

      const lo = Math.min(rankA, rankB);
      const hi = Math.max(rankA, rankB);
      const distribution = hi - lo;

      // Perfect adjacent pair: lo is even and hi = lo + 1
      if (lo % 2 === 0 && distribution === 1) {
        return maxValue;
      }

      // Reward closeness in rank (further = lower score)
      return Math.max(0, maxValue - distribution);
    },
  },
];

// ---------------------------------------------------------------------------
// Edge-building helpers
// ---------------------------------------------------------------------------

function buildEdges(
  players: PlayerState[],
  context: DubovContext,
): [number, number, DynamicUint][] {
  const edges: [number, number, DynamicUint][] = [];
  for (let index = 0; index < players.length; index++) {
    for (let index_ = index + 1; index_ < players.length; index_++) {
      const a = players.at(index);
      const b = players.at(index_);
      if (a === undefined || b === undefined) continue;
      const weight = buildEdgeWeight(DUBOV_CRITERIA, a, b, context);
      if (!weight.isZero()) {
        edges.push([index, index_, weight]);
      }
    }
  }
  return edges;
}

function runBlossom(
  players: PlayerState[],
  edges: [number, number, DynamicUint][],
  maxcardinality = true,
): Map<string, string> {
  if (players.length === 0) return new Map();
  const matching = maxWeightMatching(edges, maxcardinality);
  const result = new Map<string, string>();
  for (const [index, index_] of matching.entries()) {
    if (index_ !== undefined && index_ !== -1 && index_ > index) {
      const a = players.at(index);
      const b = players.at(index_);
      if (a === undefined || b === undefined) continue;
      result.set(a.id, b.id);
      result.set(b.id, a.id);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main pair function
// ---------------------------------------------------------------------------

function pair(players: Player[], games: Game[][]): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const totalRounds = games.length + 1;
  const isLastRound = false; // We don't know total rounds ahead of time; conservative
  const states = buildPlayerStates(players, games);

  // Compute ARO for each player
  const aroById = new Map<string, number>();
  for (const state of states) {
    aroById.set(state.id, computeARO(state, players));
  }

  // Dubov ranking: score DESC, ARO DESC, TPN ASC
  const sorted = [...states].toSorted((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const aroA = aroById.get(a.id) ?? 0;
    const aroB = aroById.get(b.id) ?? 0;
    if (aroA !== aroB) return aroB - aroA;
    return a.tpn - b.tpn;
  });

  // Build rank index (0-based position in Dubov sorted order)
  const rankIndex = new Map<string, number>();
  for (const [index, element] of sorted.entries()) {
    if (element !== undefined) rankIndex.set(element.id, index);
  }

  // Index for O(1) lookup
  const stateById = new Map<string, PlayerState>();
  for (const s of sorted) stateById.set(s.id, s);

  const needsBye = sorted.length % 2 === 1;

  // -------------------------------------------------------------------------
  // Determine bye assignee
  // -------------------------------------------------------------------------
  let byeState: PlayerState | undefined;
  if (needsBye) {
    byeState = assignBye(sorted, games, dubovByeTiebreak);
  }

  const byeId = byeState?.id;

  // Remove bye recipient from the pairing pool
  const pairedPool =
    byeId === undefined ? sorted : sorted.filter((s) => s.id !== byeId);

  // Rebuild rankIndex for pairedPool (bye recipient removed shifts indices)
  const pairedRankIndex = new Map<string, number>();
  for (const [index, element] of pairedPool.entries()) {
    if (element !== undefined) pairedRankIndex.set(element.id, index);
  }

  // Compute upfloat counts
  const upfloatCount = new Map<string, number>();
  for (const state of pairedPool) {
    const count = state.floatHistory.filter((f) => f === 'up').length;
    upfloatCount.set(state.id, count);
  }

  // MaxT = 2 + floor(totalRounds / 5)
  const maxT = 2 + Math.floor(totalRounds / 5);

  // -------------------------------------------------------------------------
  // Build context for edge weight computation
  // -------------------------------------------------------------------------
  const globalContext: DubovContext = {
    byeAssigneeScore: byeState?.score ?? 0,
    isLastRound,
    isSingleDownfloaterTheByeAssignee: false,
    maxT,
    playerCount: pairedPool.length,
    rankIndex: pairedRankIndex,
    scoreGroupShifts: new Map(),
    scoreGroupSizeBits: 1,
    scoreGroupsShift: 1,
    totalRounds,
    tournament: {
      expectedRounds: totalRounds,
      playedRounds: totalRounds - 1,
    },
    upfloatCount,
  };

  const edges = buildEdges(pairedPool, globalContext);
  const matching = runBlossom(pairedPool, edges, true);

  const allPairedTuples: [PlayerState, PlayerState][] = [];
  const seen = new Set<string>();

  for (const s of pairedPool) {
    if (seen.has(s.id)) continue;
    const partnerId = matching.get(s.id);
    if (partnerId !== undefined) {
      seen.add(s.id);
      seen.add(partnerId);
      const a = stateById.get(s.id);
      const b = stateById.get(partnerId);
      if (a === undefined || b === undefined) continue;
      allPairedTuples.push(a.tpn < b.tpn ? [a, b] : [b, a]);
    }
  }

  // -------------------------------------------------------------------------
  // Allocate colours
  // -------------------------------------------------------------------------
  const pairings = allPairedTuples.map(([a, b]) =>
    allocateColor(a, b, DUBOV_COLOR_RULES, dubovRankCompare),
  );

  return {
    byes: byeId === undefined ? [] : [{ player: byeId }],
    pairings,
  };
}

export { pair };
