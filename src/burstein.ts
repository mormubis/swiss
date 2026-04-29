/**
 * FIDE Burstein System pairing (C.04.4.2) — weighted blossom matching.
 *
 * Uses maximum-weight matching (Edmonds' blossom algorithm) so that all
 * score groups are handled correctly in a single global pass.
 *
 * Algorithm outline
 * -----------------
 * 1. Normalise game records (convert legacy bye sentinel black===white → black='').
 * 2. Build PlayerState for every player.
 * 3. Compute Buchholz and Sonneborn-Berger tiebreaks for ranking.
 * 4. Sort players by Burstein ranking:
 *      score DESC, Buchholz DESC, Sonneborn-Berger DESC, TPN ASC.
 *    (In round 1, all tiebreaks are zero so order collapses to TPN ASC.)
 * 5. Determine the bye assignee when player count is odd.
 * 6. Single global blossom pass:
 *      a. Build edges for all remaining players with full quality weights
 *         (C5–C8). C1 rematches produce zero-weight edges and are skipped.
 *      b. Run blossom with maxcardinality=true to find the optimal matching.
 * 7. Allocate colours for every pair via FIDE Article 5.
 * 8. Assign bye (odd player count) via `assignBye`.
 */

import { maxWeightMatching } from './blossom.js';
import {
  FIDE_COLOR_RULES,
  ROUND_1_COLOR_RULE,
  allocateColor,
  assignBye,
  buildPlayerStates,
  scoreGroups,
} from './utilities.js';
import { buildEdgeWeight } from './weights.js';

import type { DynamicUint } from './dynamic-uint.js';
import type { PairOptions, TraceCallback } from './trace.js';
import type { Game, PairingResult, Player } from './types.js';
import type { PlayerState } from './utilities.js';
import type { BracketContext, Criterion } from './weights.js';

// ---------------------------------------------------------------------------
// Game normalisation — convert legacy bye sentinel (black === white) to the
// canonical new sentinel (black === '').
// ---------------------------------------------------------------------------

function normaliseGames(games: Game[][]): Game[][] {
  return games.map((round) =>
    round.map((g) => (g.black === g.white ? { ...g, black: '' } : g)),
  );
}

// ---------------------------------------------------------------------------
// Tiebreak computations
// ---------------------------------------------------------------------------

/**
 * Computes Buchholz score for a player: sum of current scores of all
 * opponents. For unplayed rounds (virtual opponent = self), uses the
 * player's own score contribution as per Article 1.7.2.
 *
 * For our purposes (pairing, not standings) we use the simple version:
 * sum of opponent scores for games actually played.
 */
function computeBuchholz(
  state: PlayerState,
  stateById: Map<string, PlayerState>,
): number {
  let sum = 0;
  for (const oppId of state.opponents) {
    const opp = stateById.get(oppId);
    sum += opp?.score ?? 0;
  }
  return sum;
}

/**
 * Computes Sonneborn-Berger index for a player: sum of (result * opponent score).
 * Win against opponent → add opponent's score.
 * Draw against opponent → add 0.5 * opponent's score.
 * Loss against opponent → add 0.
 */
function computeSonnebornBerger(
  state: PlayerState,
  games: Game[][],
  stateById: Map<string, PlayerState>,
): number {
  let sum = 0;
  for (const round of games) {
    for (const g of round) {
      if (g.black === '') continue;
      if (g.white === state.id) {
        const opp = stateById.get(g.black);
        if (opp !== undefined) {
          sum += g.result * opp.score;
        }
      } else if (g.black === state.id) {
        const opp = stateById.get(g.white);
        if (opp !== undefined) {
          sum += (1 - g.result) * opp.score;
        }
      }
    }
  }
  return sum;
}

// ---------------------------------------------------------------------------
// FIDE Article 5 colour rules
// ---------------------------------------------------------------------------

const BURSTEIN_COLOR_RULES = [ROUND_1_COLOR_RULE, ...FIDE_COLOR_RULES];

// ---------------------------------------------------------------------------
// Burstein ranking comparator
//
// Ranking is: Buchholz DESC, Sonneborn-Berger DESC, TPN ASC.
// (Score is NOT used in the Burstein ranking order — Article 1.8.)
// In round 1 all tiebreaks are zero so this collapses to TPN ASC.
// ---------------------------------------------------------------------------

/**
 * Rank comparator for allocateColor.
 * Returns negative if `a` ranks higher (lower = better rank).
 * Burstein ranking: Buchholz DESC, SB DESC, TPN ASC.
 */
function bursteinRankCompare(
  a: PlayerState,
  b: PlayerState,
  buchholzById: Map<string, number>,
  sbById: Map<string, number>,
): number {
  const bA = buchholzById.get(a.id) ?? 0;
  const bB = buchholzById.get(b.id) ?? 0;
  if (bA !== bB) return bB - bA; // higher Buchholz ranks first
  const sA = sbById.get(a.id) ?? 0;
  const sB = sbById.get(b.id) ?? 0;
  if (sA !== sB) return sB - sA; // higher SB ranks first
  return a.tpn - b.tpn; // lower TPN ranks first
}

// ---------------------------------------------------------------------------
// Burstein pairing criteria
//
// Each criterion returns a NON-NEGATIVE value ∈ [0, 2^bits).
// Higher is better. "Minimize X" is encoded as "maximize (max - X)".
// ---------------------------------------------------------------------------

/**
 * Extended BracketContext for Burstein: includes rank index map for
 * fold-over pairing criterion encoding.
 */
interface BursteinContext extends BracketContext {
  /** Map from player id → rank index (0-based) in Burstein sorted order */
  rankIndex: Map<string, number>;
  /** Total number of players being paired */
  playerCount: number;
}

const BURSTEIN_CRITERIA: Criterion[] = [
  // C1 is handled by buildEdgeWeight (zero for rematches).

  // C3: Absolute colour conflict.
  // Two players with the same absolute colour preference shall not meet.
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

  // C5: Maximise pairs (minimise outgoing floaters).
  // 1 bit: 1 = same score group (no float needed), 0 = cross-group
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState) => {
      return a.score === b.score ? 1 : 0;
    },
  },

  // C6: Minimise scores of outgoing floaters (descending).
  // 8 bits: cross-group pair penalty = 255 - scoreDiff*2; same group = 255
  {
    bits: 8,
    evaluate: (a: PlayerState, b: PlayerState) => {
      if (a.score === b.score) return 255;
      const scoreDiff = Math.abs(a.score - b.score);
      return Math.max(0, 255 - Math.floor(scoreDiff * 2));
    },
  },

  // C8: Minimise the number of players who do not get their colour preference.
  // 2 bits: encode (3 - violations), 0–2 violations
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

  // Fold-over pairing criterion.
  //
  // Burstein pairs rank 1 with rank N, rank 2 with rank N-1, etc.
  // For a bracket of N players sorted by Burstein ranking (0-indexed),
  // the ideal match for player at rank k is player at rank (N-1-k).
  //
  // For a pair (rankA, rankB), the fold score is:
  //   N - |rankA + rankB - (N-1)|
  // When rankA + rankB = N-1 (the perfect fold), score = N (maximum).
  // Closer sums give higher scores, farther sums give lower scores.
  //
  // bits = ceil(log2(playerCount + 1)), at least 4
  {
    bits: (context: BracketContext) => {
      const bContext = context as BursteinContext;
      return Math.max(4, Math.ceil(Math.log2(bContext.playerCount + 2)));
    },
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const bContext = context as BursteinContext;
      const n = bContext.playerCount;

      const rankA = bContext.rankIndex.get(a.id);
      const rankB = bContext.rankIndex.get(b.id);
      if (rankA === undefined || rankB === undefined) return 0;

      // foldScore = N - |rankA + rankB - (N-1)|
      const foldScore = n - Math.abs(rankA + rankB - (n - 1));
      return Math.max(0, foldScore);
    },
  },
];

// ---------------------------------------------------------------------------
// Edge-building helpers
// ---------------------------------------------------------------------------

function buildEdges(
  players: PlayerState[],
  context: BursteinContext,
): [number, number, DynamicUint][] {
  const edges: [number, number, DynamicUint][] = [];
  for (let index = 0; index < players.length; index++) {
    for (let index_ = index + 1; index_ < players.length; index_++) {
      const a = players.at(index);
      const b = players.at(index_);
      if (a === undefined || b === undefined) continue;
      const weight = buildEdgeWeight(BURSTEIN_CRITERIA, a, b, context);
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
  trace?: TraceCallback,
): Map<string, string> {
  if (players.length === 0) return new Map();
  if (trace) {
    trace({
      edgeCount: edges.length,
      phase: 'main',
      system: 'burstein',
      type: 'pairing:blossom-invoked',
      vertexCount: players.length,
    });
  }
  const matching = maxWeightMatching(edges, maxcardinality, trace);
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
  if (trace) {
    const pairs: [string, string][] = [];
    for (const [a, b] of result) {
      if (a < b) pairs.push([a, b]);
    }
    trace({
      pairs,
      phase: 'main',
      system: 'burstein',
      type: 'pairing:blossom-result',
      unmatchedCount: players.length - pairs.length * 2,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main pair function
// ---------------------------------------------------------------------------

function pair(
  players: Player[],
  games: Game[][],
  options?: PairOptions,
): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const trace = options?.trace;

  const totalRounds = games.length + 1;

  // Normalise legacy bye sentinel (black === white) to canonical (black === '')
  const normalisedGames = normaliseGames(games);

  const states = buildPlayerStates(players, normalisedGames);

  // Build O(1) lookup by id
  const stateById = new Map<string, PlayerState>();
  for (const s of states) stateById.set(s.id, s);

  // Compute tiebreaks
  const buchholzById = new Map<string, number>();
  const sbById = new Map<string, number>();
  for (const state of states) {
    buchholzById.set(state.id, computeBuchholz(state, stateById));
    sbById.set(
      state.id,
      computeSonnebornBerger(state, normalisedGames, stateById),
    );
  }

  // Burstein ranking: score DESC, Buchholz DESC, SB DESC, TPN ASC
  // Note: score DESC is included here for initial sorting to group players,
  // but Burstein Article 1.8 says ranking is by Index only (not score).
  // For the purposes of the fold-over and colour allocation, we use the
  // full Burstein index (Buchholz DESC, SB DESC, TPN ASC) within each
  // score group. For cross-score-group cases the C5/C6 criteria handle
  // floater minimisation.
  const sorted = [...states].toSorted((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return bursteinRankCompare(a, b, buchholzById, sbById);
  });

  const needsBye = sorted.length % 2 === 1;

  // -------------------------------------------------------------------------
  // Determine bye assignee
  // 3.1.3 lowest score
  // 3.1.4 highest number of games played (fewest unplayed rounds)
  // 3.1.5 lowest ranking according to Article 1.8 (highest TPN in ranking)
  // -------------------------------------------------------------------------

  // Bye tiebreak: fewest unplayed rounds first; among ties, lowest ranked
  // (highest in Burstein index = last in sorted order = largest index)
  function bursteinByeTiebreak(a: PlayerState, b: PlayerState): number {
    if (a.unplayedRounds !== b.unplayedRounds)
      return a.unplayedRounds - b.unplayedRounds;
    // Lower ranking in Burstein order → gets bye first (3.1.5 "lowest ranking")
    // In sorted array, higher index = lower ranking, so we want the one at
    // higher index first — i.e. the one that compares as "greater" in ranking
    // (meaning worse = larger positive from bursteinRankCompare).
    return -bursteinRankCompare(a, b, buchholzById, sbById);
  }

  let byeState: PlayerState | undefined;
  if (needsBye) {
    byeState = assignBye(sorted, normalisedGames, bursteinByeTiebreak);
  }

  const byeId = byeState?.id;

  if (trace && byeId !== undefined) {
    trace({
      playerId: byeId,
      reason: 'lowest-score-no-prior-bye',
      system: 'burstein',
      type: 'pairing:bye-assigned',
    });
  }

  // Remove bye recipient from the pairing pool
  const pairedPool =
    byeId === undefined ? sorted : sorted.filter((s) => s.id !== byeId);

  // Build rank index (0-based position in Burstein sorted order for paired pool)
  const rankIndex = new Map<string, number>();
  for (const [index, element] of pairedPool.entries()) {
    if (element !== undefined) rankIndex.set(element.id, index);
  }

  // -------------------------------------------------------------------------
  // Build context for edge weight computation
  // -------------------------------------------------------------------------
  const globalContext: BursteinContext = {
    byeAssigneeScore: byeState?.score ?? 0,
    isSingleDownfloaterTheByeAssignee: false,
    playerCount: pairedPool.length,
    rankIndex,
    scoreGroupShifts: new Map(),
    scoreGroupSizeBits: 1,
    scoreGroupsShift: 1,
    tournament: {
      expectedRounds: totalRounds,
      playedRounds: totalRounds - 1,
    },
  };

  if (trace) {
    const sgMap = scoreGroups(pairedPool);
    const groups: { playerIds: string[]; score: number }[] = [];
    for (const [score, members] of sgMap) {
      groups.push({ playerIds: members.map((m) => m.id), score });
    }
    trace({ groups, system: 'burstein', type: 'pairing:score-groups' });
  }

  const edges = buildEdges(pairedPool, globalContext);
  const matching = runBlossom(pairedPool, edges, true, trace);

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
      if (trace) {
        trace({
          phase: 'main',
          playerA: a.id,
          playerB: b.id,
          system: 'burstein',
          type: 'pairing:pair-finalized',
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Allocate colours
  // -------------------------------------------------------------------------
  // Rank comparator for allocateColor: Burstein ranking
  function rankCompare(a: PlayerState, b: PlayerState): number {
    return bursteinRankCompare(a, b, buchholzById, sbById);
  }

  const pairings = allPairedTuples.map(([a, b]) =>
    allocateColor(a, b, BURSTEIN_COLOR_RULES, rankCompare),
  );

  if (trace) {
    for (const p of pairings) {
      trace({
        black: p.black,
        rule: 'burstein-article-5.2',
        system: 'burstein',
        type: 'pairing:color-allocated',
        white: p.white,
      });
    }
  }

  return {
    byes: byeId === undefined ? [] : [{ player: byeId }],
    pairings,
  };
}

export { pair };
