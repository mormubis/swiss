/**
 * FIDE Lim System pairing (C.04.4.3) — weighted blossom matching.
 *
 * Uses maximum-weight matching (Edmonds' blossom algorithm) so that all
 * score groups are handled correctly in a single global pass.
 *
 * The Lim system shares the same ranking (score desc, TPN asc) and round-1
 * top-half-vs-bottom-half pairing as the Dutch system. The key Lim feature
 * is bi-directional score-group traversal (highest → lowest → median), but
 * since we run a single global blossom pass the weight encoding handles
 * score-group membership automatically.
 *
 * Algorithm outline
 * -----------------
 * 1. Normalise bye sentinels (black === white → black === '').
 * 2. Build PlayerState for every player.
 * 3. Sort by score DESC, TPN ASC.
 * 4. Determine the bye assignee when player count is odd.
 * 5. Single global blossom pass:
 *      a. Build edges for all remaining players with full quality weights.
 *         C1 rematches produce zero-weight edges and are skipped.
 *      b. Run blossom with maxcardinality=true to find the optimal matching.
 * 6. Allocate colours for every pair via FIDE Article 5.
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
// FIDE Article 5.2 colour rules (same as Dutch)
// ---------------------------------------------------------------------------

function rankPreference(s: PlayerState['preferenceStrength']): number {
  if (s === 'absolute') return 3;
  if (s === 'strong') return 2;
  if (s === 'mild') return 1;
  return 0;
}

const LIM_COLOR_RULES: ColorRule[] = [
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
function limRankCompare(a: PlayerState, b: PlayerState): number {
  return a.tpn - b.tpn;
}

// Bye tiebreak: among equal-score players, highest TPN (lowest ranked) first
function limByeTiebreak(a: PlayerState, b: PlayerState): number {
  if (a.unplayedRounds !== b.unplayedRounds)
    return a.unplayedRounds - b.unplayedRounds;
  return b.tpn - a.tpn;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

/**
 * Extended BracketContext for Lim.
 */
interface LimContext extends BracketContext {
  currentBracketIds: Set<string>;
  nextBracketIds: Set<string>;
  totalRounds: number;
}

/**
 * Compute score-group parameters needed by the criteria.
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

// ---------------------------------------------------------------------------
// Score-group index helpers
// ---------------------------------------------------------------------------

/**
 * Returns a map from player id → 0-based position within their score group
 * (sorted by TPN ascending).
 */
function buildGroupPositions(states: PlayerState[]): Map<string, number> {
  const groups = scoreGroups(states);
  const positions = new Map<string, number>();
  for (const [, members] of groups) {
    for (const [index, member] of members.entries()) {
      positions.set(member.id, index);
    }
  }
  return positions;
}

/**
 * Returns a map from score → group size.
 */
function buildGroupSizes(states: PlayerState[]): Map<number, number> {
  const groups = scoreGroups(states);
  const sizes = new Map<number, number>();
  for (const [sc, members] of groups) {
    sizes.set(sc, members.length);
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// Lim pairing criteria
//
// Very similar to Dutch. The Lim system uses the same ranking and
// score-group structure; bi-directional traversal is a notional feature
// of the spec that the blossom weight encoding handles naturally.
//
// Within a score group we add a criterion that prefers the "direct opposite"
// pairing: S1[i] paired with S2[i] (i.e. rank-i with rank-(i+half)).
// ---------------------------------------------------------------------------

interface LimContextFull extends LimContext {
  groupPositions: Map<string, number>;
  groupSizes: Map<number, number>;
}

const LIM_CRITERIA: Criterion[] = [
  // C6: Minimise downfloaters = maximise pairs within same score group.
  {
    bits: (context: BracketContext) =>
      (context as LimContext).scoreGroupSizeBits + 1,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const lContext = context as LimContext;
      const bits = lContext.scoreGroupSizeBits + 1;
      const max = (1 << bits) - 1;
      if (a.score === b.score) return max;
      return 0;
    },
  },
  // C7: Minimise downfloater scores (descending).
  {
    bits: (context: BracketContext) => (context as LimContext).scoreGroupsShift,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const lContext = context as LimContext;
      if (lContext.scoreGroupsShift === 0) return 0;

      let value = 0;
      if (a.score === b.score) {
        const shift = lContext.scoreGroupShifts.get(a.score) ?? 0;
        const bits = lContext.scoreGroupSizeBits;
        if (shift + bits - 1 < 32) value |= 1 << (shift + bits - 1);
        if (shift + bits < 32) value |= 1 << (shift + bits);
      } else {
        const lower = a.score < b.score ? a : b;
        const shift = lContext.scoreGroupShifts.get(lower.score) ?? 0;
        const bits = lContext.scoreGroupSizeBits;
        if (shift + bits - 1 < 32) value |= 1 << (shift + bits - 1);
      }
      return value;
    },
  },
  // Lim-specific: within same score group, prefer the "direct opposite"
  // pairing S1[i] with S2[i] (i.e. rank-pos i with rank-pos i+half).
  // Encodes how close the pairing is to the ideal top-half/bottom-half split.
  // Uses ceil(log2(maxGroupSize+1)) bits.
  {
    bits: (context: BracketContext) =>
      (context as LimContext).scoreGroupSizeBits,
    evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => {
      const lContext = context as LimContextFull;
      if (a.score !== b.score) return 0;

      const groupSize = lContext.groupSizes.get(a.score) ?? 2;
      const half = Math.floor(groupSize / 2);
      if (half === 0) return 0;

      const posA = lContext.groupPositions.get(a.id) ?? 0;
      const posB = lContext.groupPositions.get(b.id) ?? 0;

      // Ideal: |posA - posB| === half
      const distribution = Math.abs(posA - posB);
      const deviation = Math.abs(distribution - half);
      // More bits means larger groups; maxDeviation = half
      return Math.max(0, half - deviation);
    },
  },
  // C12: Minimise players not getting colour preference.
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
];

// ---------------------------------------------------------------------------
// Edge-building helpers
// ---------------------------------------------------------------------------

/**
 * Build a complete graph for a set of players.
 * Returns [indexA, indexB, weight] tuples for maxWeightMatching.
 * Edges with zero weight (C1 rematches) are omitted so that
 * maxcardinality mode never forces a rematch.
 */
function buildEdges(
  players: PlayerState[],
  context: LimContextFull,
): [number, number, DynamicUint][] {
  const edges: [number, number, DynamicUint][] = [];
  for (let index = 0; index < players.length; index++) {
    for (let index_ = index + 1; index_ < players.length; index_++) {
      const a = players.at(index);
      const b = players.at(index_);
      if (a === undefined || b === undefined) continue;
      const weight = buildEdgeWeight(LIM_CRITERIA, a, b, context);
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
// Bye sentinel normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise games so that the old `black === white` bye sentinel is converted
 * to the canonical `black === ''` sentinel expected by buildPlayerStates.
 */
function normaliseGames(games: Game[][]): Game[][] {
  return games.map((round) =>
    round.map((game) =>
      game.black === game.white ? { ...game, black: '' } : game,
    ),
  );
}

// ---------------------------------------------------------------------------
// Main pair function
// ---------------------------------------------------------------------------

function pair(players: Player[], games: Game[][]): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const normalisedGames = normaliseGames(games);
  const totalRounds = normalisedGames.length + 1;
  const states = buildPlayerStates(players, normalisedGames);

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
    byeState = assignBye(sorted, normalisedGames, limByeTiebreak);
  }

  const byeId = byeState?.id;

  // Remove bye recipient from the pairing pool
  const pairedPool =
    byeId === undefined ? sorted : sorted.filter((s) => s.id !== byeId);

  // Precompute score-group params once
  const sgParameters = computeScoreGroupParameters(pairedPool);
  const groupPositions = buildGroupPositions(pairedPool);
  const groupSizes = buildGroupSizes(pairedPool);

  // -------------------------------------------------------------------------
  // Single global blossom pass
  // -------------------------------------------------------------------------
  const globalContext: LimContextFull = {
    byeAssigneeScore: byeState?.score ?? 0,
    currentBracketIds: new Set(pairedPool.map((s) => s.id)),
    groupPositions,
    groupSizes,
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
    allocateColor(a, b, LIM_COLOR_RULES, limRankCompare),
  );

  return {
    byes: byeId === undefined ? [] : [{ player: byeId }],
    pairings,
  };
}

export { pair };
