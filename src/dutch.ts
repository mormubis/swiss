/**
 * FIDE Dutch System pairing (C.04.3) — weighted blossom matching.
 *
 * Uses maximum-weight matching (Edmonds' blossom algorithm) so that all
 * score groups are handled correctly in a single global pass.
 *
 * Algorithm outline
 * -----------------
 * 1. Build PlayerState for every player.
 * 2. Compute score-group parameters (bit widths for criteria C6/C7).
 * 3. Determine the bye assignee when player count is odd.
 * 4. Single global blossom pass:
 *      a. Build edges for all remaining players with full quality weights
 *         (C5–C21). C1 rematches produce zero-weight edges and are skipped.
 *      b. Run blossom with maxcardinality=true to find the optimal matching.
 * 5. Allocate colours for every pair via FIDE Article 5.
 * 6. Assign bye (odd player count) via `assignBye`.
 */

import { maxWeightMatching } from './blossom.js';
import {
  allocateColor,
  assignBye,
  buildPlayerStates,
  scoreGroups,
} from './utilities.js';
import { buildEdgeWeight } from './weights.js';

import type { DynamicUint } from './dynamic-uint.js';
import type { Game, PairingResult, Player } from './types.js';
import type { ColorRule, PlayerState } from './utilities.js';
import type { BracketContext, Criterion } from './weights.js';

// ---------------------------------------------------------------------------
// FIDE Article 5.2 colour rules
// ---------------------------------------------------------------------------

function rankPreference(s: PlayerState['preferenceStrength']): number {
  if (s === 'absolute') return 3;
  if (s === 'strong') return 2;
  if (s === 'mild') return 1;
  return 0;
}

const DUTCH_COLOR_RULES: ColorRule[] = [
  // 5.2.1 Grant both colour preferences (if they differ)
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
  // 5.2.2 Grant stronger preference; both absolute → wider colorDiff wins
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
  // 5.2.3 Alternate from most recent divergent round
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
  // 5.2.4 Grant HRP's preference
  (hrp) => {
    if (hrp.preferredColor !== undefined) {
      return hrp.preferredColor === 'white' ? 'hrp-white' : 'hrp-black';
    }
    return 'continue';
  },
  // 5.2.5 Odd TPN → initial colour (white)
  (hrp) => (hrp.tpn % 2 === 1 ? 'hrp-white' : 'hrp-black'),
];

// Rank comparator for allocateColor: lower TPN = higher rank
function dutchRankCompare(a: PlayerState, b: PlayerState): number {
  return a.tpn - b.tpn;
}

// Bye tiebreak: among equal-score players, highest TPN (lowest ranked) first
function dutchByeTiebreak(a: PlayerState, b: PlayerState): number {
  if (a.unplayedRounds !== b.unplayedRounds)
    return a.unplayedRounds - b.unplayedRounds;
  return b.tpn - a.tpn;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether `state` is a topscorer.
 * Topscorers are players with score > (totalRounds / 2) when pairing the
 * final round.
 * Article 1.8: score > 50% of maximum possible score for the final round.
 */
function isTopscorer(state: PlayerState, totalRounds: number): boolean {
  return state.score > totalRounds / 2;
}

// ---------------------------------------------------------------------------
// Dutch pairing criteria (C5–C21)
//
// Each criterion returns a NON-NEGATIVE value ∈ [0, 2^bits).
// "Minimize X" is encoded as "maximize (max - X)".
//
// The criteria operate on a pair (a, b) plus a BracketContext.
// ---------------------------------------------------------------------------

/**
 * Extended BracketContext for Dutch: includes current/next bracket IDs so
 * criteria can distinguish current-bracket players from next-bracket players.
 */
interface DutchContext extends BracketContext {
  currentBracketIds: Set<string>;
  nextBracketIds: Set<string>;
  totalRounds: number;
}

/**
 * Compute score-group parameters needed by the criteria.
 *
 * Returns:
 *   scoreGroupSizeBits — ceil(log2(maxGroupSize + 1)), at least 1
 *   scoreGroupShifts   — Map<score, bitOffset>, built from lowest score up
 *   scoreGroupsShift   — total bit width of all score groups
 */
function computeScoreGroupParameters(states: PlayerState[]): {
  scoreGroupShifts: Map<number, number>;
  scoreGroupSizeBits: number;
  scoreGroupsShift: number;
} {
  const groups = scoreGroups(states);
  let maxScoreGroupSize = 0;
  for (const [, members] of groups) {
    if (members.length > maxScoreGroupSize) maxScoreGroupSize = members.length;
  }

  const scoreGroupSizeBits = Math.max(
    1,
    Math.ceil(Math.log2(maxScoreGroupSize + 1)),
  );

  // Build shifts from lowest score upward
  const sortedScores = [...groups.keys()].toSorted((a, b) => a - b);
  const scoreGroupShifts = new Map<number, number>();
  let offset = 0;
  for (const sc of sortedScores) {
    scoreGroupShifts.set(sc, offset);
    const groupSize = groups.get(sc)?.length ?? 0;
    offset += Math.max(1, Math.ceil(Math.log2(groupSize + 1)));
  }
  const scoreGroupsShift = Math.max(1, offset);

  return { scoreGroupShifts, scoreGroupSizeBits, scoreGroupsShift };
}

const DUTCH_CRITERIA: Criterion[] = [
  // C5: Minimise the score of the bye assignee.
  // 1 bit: 1 = this pair does NOT produce a bye from the bye-assignee's score.
  // For pairs not involving the bye assignee score, reward fully.
  {
    bits: 1,
    evaluate: (_a, _b, context: BracketContext) => {
      const dContext = context as DutchContext;
      if (!dContext.isSingleDownfloaterTheByeAssignee) return 1;
      return 1;
    },
  },
  // C6: Minimise downfloaters = maximise pairs within same score group.
  // sgBits + 1: both in same score group = max, cross-group = 0.
  {
    bits: (context: BracketContext) =>
      (context as DutchContext).scoreGroupSizeBits + 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      const bits = dContext.scoreGroupSizeBits + 1;
      const max = (1 << bits) - 1;
      if (a.score === b.score) return max;
      return 0;
    },
  },
  // C7: Minimise downfloater scores (descending).
  // For same-group pairs: reward both (they are paired, not floating).
  // For cross-group pairs: reward the higher-score player staying in their
  // group (i.e. reward based on score-group bit position).
  {
    bits: (context: BracketContext) =>
      (context as DutchContext).scoreGroupsShift,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      if (dContext.scoreGroupsShift === 0) return 0;

      let value = 0;
      // Both players in the same group: both contribute their score-group bit.
      if (a.score === b.score) {
        const shift = dContext.scoreGroupShifts.get(a.score) ?? 0;
        const bits = dContext.scoreGroupSizeBits;
        if (shift + bits - 1 < 32) value |= 1 << (shift + bits - 1);
        if (shift + bits < 32) value |= 1 << (shift + bits); // second bit for both
      } else {
        // Cross-group: reward the lower-score player's group bit to minimise
        // the score of whoever floats.  The higher-score player is the
        // downfloater; we want to minimise their score.
        const lower = a.score < b.score ? a : b;
        const shift = dContext.scoreGroupShifts.get(lower.score) ?? 0;
        const bits = dContext.scoreGroupSizeBits;
        if (shift + bits - 1 < 32) value |= 1 << (shift + bits - 1);
      }
      return value;
    },
  },
  // C9: Minimise unplayed rounds of bye assignee.
  // 4 bits: encode (15 - unplayedRounds) → higher = fewer unplayed rounds
  {
    bits: 4,
    evaluate: (_a, _b, context: BracketContext) => {
      const dContext = context as DutchContext;
      if (!dContext.isSingleDownfloaterTheByeAssignee) return 15;
      return 15;
    },
  },
  // C3: Non-topscorers with same absolute colour preference must not meet.
  // 1 bit: 1 = no violation
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      const totalRounds = dContext.totalRounds;
      const aTop = isTopscorer(a, totalRounds);
      const bTop = isTopscorer(b, totalRounds);
      if (
        !aTop &&
        !bTop &&
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
  // C10: Minimise topscorers/opponents with |colorDiff| > 2 after this round.
  // 4 bits: encode (15 - violations)
  {
    bits: 4,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      const totalRounds = dContext.totalRounds;
      const aTop = isTopscorer(a, totalRounds);
      const bTop = isTopscorer(b, totalRounds);

      // Heuristic projected color
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
      const aDiffAfter = a.colorDiff + (aColor === 'white' ? 1 : -1);
      const bDiffAfter = b.colorDiff + (bColor === 'white' ? 1 : -1);
      if ((aTop || bTop) && Math.abs(aDiffAfter) > 2) violations++;
      if ((aTop || bTop) && Math.abs(bDiffAfter) > 2) violations++;
      return Math.max(0, 15 - violations);
    },
  },
  // C11: Minimise topscorers getting same colour 3x in a row.
  // 4 bits: encode (15 - violations)
  {
    bits: 4,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      const totalRounds = dContext.totalRounds;
      const aTop = isTopscorer(a, totalRounds);
      const bTop = isTopscorer(b, totalRounds);

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
      if (aTop) {
        const aHist = a.colorHistory
          .filter((c): c is 'black' | 'white' => c !== undefined)
          .slice(-2);
        if (aHist.length === 2 && aHist[0] === aColor && aHist[1] === aColor)
          violations++;
      }
      if (bTop) {
        const bHist = b.colorHistory
          .filter((c): c is 'black' | 'white' => c !== undefined)
          .slice(-2);
        if (bHist.length === 2 && bHist[0] === bColor && bHist[1] === bColor)
          violations++;
      }
      return Math.max(0, 15 - violations);
    },
  },
  // C12: Minimise players not getting colour preference.
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
  // C13: Minimise players not getting strong/absolute preference.
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
      if (
        (a.preferenceStrength === 'absolute' ||
          a.preferenceStrength === 'strong') &&
        a.preferredColor !== undefined &&
        a.preferredColor !== aColor
      )
        violations++;
      if (
        (b.preferenceStrength === 'absolute' ||
          b.preferenceStrength === 'strong') &&
        b.preferredColor !== undefined &&
        b.preferredColor !== bColor
      )
        violations++;
      return Math.max(0, 3 - violations);
    },
  },
  // C14: Minimise resident downfloaters who received a downfloat last round.
  // 1 bit: 1 = no violation
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      const aFl = a.floatHistory.at(-1);
      const bFl = b.floatHistory.at(-1);
      const aInCurrent = dContext.currentBracketIds.has(a.id);
      const bInCurrent = dContext.currentBracketIds.has(b.id);
      const aConsec = aInCurrent && aFl === 'down';
      const bConsec = bInCurrent && bFl === 'down';
      return aConsec || bConsec ? 0 : 1;
    },
  },
  // C15: Minimise MDP opponents who received an upfloat last round.
  // 1 bit: 1 = no violation
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      const aInCurrent = dContext.currentBracketIds.has(a.id);
      const bInCurrent = dContext.currentBracketIds.has(b.id);
      if (aInCurrent !== bInCurrent) {
        const resident = aInCurrent ? a : b;
        if (resident.floatHistory.at(-1) === 'up') return 0;
      }
      return 1;
    },
  },
  // C16: Minimise resident downfloaters who received a downfloat 2 rounds ago.
  // 1 bit: 1 = no violation
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      const aInCurrent = dContext.currentBracketIds.has(a.id);
      const bInCurrent = dContext.currentBracketIds.has(b.id);
      const aFl2 = a.floatHistory.at(-2);
      const bFl2 = b.floatHistory.at(-2);
      const aConsec = aInCurrent && aFl2 === 'down';
      const bConsec = bInCurrent && bFl2 === 'down';
      return aConsec || bConsec ? 0 : 1;
    },
  },
  // C17: Minimise MDP opponents who received an upfloat 2 rounds ago.
  // 1 bit: 1 = no violation
  {
    bits: 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const dContext = context as DutchContext;
      const aInCurrent = dContext.currentBracketIds.has(a.id);
      const bInCurrent = dContext.currentBracketIds.has(b.id);
      if (aInCurrent !== bInCurrent) {
        const resident = aInCurrent ? a : b;
        if (resident.floatHistory.at(-2) === 'up') return 0;
      }
      return 1;
    },
  },
  // C18: Minimise score differences of MDPs who received a downfloat last round.
  // 8 bits: encode (255 - diff*2)
  {
    bits: 8,
    evaluate: (a: PlayerState, b: PlayerState) => {
      const scoreDiff = Math.abs(a.score - b.score);
      const aFl = a.floatHistory.at(-1);
      const bFl = b.floatHistory.at(-1);
      if (a.score > b.score && aFl === 'down')
        return Math.max(0, 255 - scoreDiff * 2);
      if (b.score > a.score && bFl === 'down')
        return Math.max(0, 255 - scoreDiff * 2);
      return 255;
    },
  },
  // C19: Minimise score differences of MDP opponents who received upfloat last round.
  // 8 bits
  {
    bits: 8,
    evaluate: (a: PlayerState, b: PlayerState) => {
      const scoreDiff = Math.abs(a.score - b.score);
      const aFl = a.floatHistory.at(-1);
      const bFl = b.floatHistory.at(-1);
      if (a.score < b.score && aFl === 'up')
        return Math.max(0, 255 - scoreDiff * 2);
      if (b.score < a.score && bFl === 'up')
        return Math.max(0, 255 - scoreDiff * 2);
      return 255;
    },
  },
  // C20: Minimise score differences of MDPs who received a downfloat 2 rounds ago.
  // 8 bits
  {
    bits: 8,
    evaluate: (a: PlayerState, b: PlayerState) => {
      const scoreDiff = Math.abs(a.score - b.score);
      const aFl2 = a.floatHistory.at(-2);
      const bFl2 = b.floatHistory.at(-2);
      if (a.score > b.score && aFl2 === 'down')
        return Math.max(0, 255 - scoreDiff * 2);
      if (b.score > a.score && bFl2 === 'down')
        return Math.max(0, 255 - scoreDiff * 2);
      return 255;
    },
  },
  // C21: Minimise score differences of MDP opponents who received upfloat 2 rounds ago.
  // 8 bits
  {
    bits: 8,
    evaluate: (a: PlayerState, b: PlayerState) => {
      const scoreDiff = Math.abs(a.score - b.score);
      const aFl2 = a.floatHistory.at(-2);
      const bFl2 = b.floatHistory.at(-2);
      if (a.score < b.score && aFl2 === 'up')
        return Math.max(0, 255 - scoreDiff * 2);
      if (b.score < a.score && bFl2 === 'up')
        return Math.max(0, 255 - scoreDiff * 2);
      return 255;
    },
  },
];

// ---------------------------------------------------------------------------
// Edge-building helpers
// ---------------------------------------------------------------------------

/**
 * Build a complete graph for a set of players.
 * Returns [indexA, indexB, weight] tuples for maxWeightMatching.
 * Edges with zero weight (C1 rematches) are omitted entirely so that
 * maxcardinality mode never forces a rematch.
 */
function buildEdges(
  players: PlayerState[],
  context: DutchContext,
): [number, number, DynamicUint][] {
  const edges: [number, number, DynamicUint][] = [];
  for (let index = 0; index < players.length; index++) {
    for (let index_ = index + 1; index_ < players.length; index_++) {
      const a = players.at(index);
      const b = players.at(index_);
      if (a === undefined || b === undefined) continue;
      const weight = buildEdgeWeight(DUTCH_CRITERIA, a, b, context);
      if (!weight.isZero()) {
        edges.push([index, index_, weight]);
      }
    }
  }
  return edges;
}

/**
 * Run blossom on edges and return a Map<id, id> of matched pairs.
 */
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
  const states = buildPlayerStates(players, games);

  // Sort: score DESC, tpn ASC
  const sorted = [...states].toSorted((a, b) =>
    a.score === b.score ? a.tpn - b.tpn : b.score - a.score,
  );

  // Index for O(1) lookup
  const stateById = new Map<string, PlayerState>();
  for (const s of sorted) stateById.set(s.id, s);

  const needsBye = sorted.length % 2 === 1;

  // -------------------------------------------------------------------------
  // Determine bye assignee
  // -------------------------------------------------------------------------
  let byeState: PlayerState | undefined;
  if (needsBye) {
    byeState = assignBye(sorted, games, dutchByeTiebreak);
  }

  const byeId = byeState?.id;

  // Remove bye recipient from the pairing pool
  const pairedPool =
    byeId === undefined ? sorted : sorted.filter((s) => s.id !== byeId);

  // Precompute score-group params once (same for all brackets)
  const sgParameters = computeScoreGroupParameters(pairedPool);

  // -------------------------------------------------------------------------
  // Single global blossom pass
  //
  // Rather than bracket-by-bracket (which can leave players unmatched when
  // many rematches exist), we run one blossom over all players. The C6/C7
  // criteria encode score-group membership so the blossom naturally minimises
  // downfloaters while guaranteeing maximum cardinality.
  // -------------------------------------------------------------------------
  const globalContext: DutchContext = {
    byeAssigneeScore: byeState?.score ?? 0,
    // In global mode every player is "current"; score-group membership is
    // encoded via the C6/C7 criteria using scoreGroupShifts.
    currentBracketIds: new Set(pairedPool.map((s) => s.id)),
    isSingleDownfloaterTheByeAssignee: false,
    nextBracketIds: new Set(),
    scoreGroupShifts: sgParameters.scoreGroupShifts,
    scoreGroupSizeBits: sgParameters.scoreGroupSizeBits,
    scoreGroupsShift: sgParameters.scoreGroupsShift,
    totalRounds,
    tournament: {
      expectedRounds: totalRounds,
      playedRounds: totalRounds - 1,
    },
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
    allocateColor(a, b, DUTCH_COLOR_RULES, dutchRankCompare),
  );

  return {
    byes: byeId === undefined ? [] : [{ player: byeId }],
    pairings,
  };
}

export { pair };
