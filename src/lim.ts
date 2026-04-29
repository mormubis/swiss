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

import { buildBlossomEdges, runBlossom } from './pairing-helpers.js';
import {
  FIDE_COLOR_RULES,
  allocateColor,
  assignBye,
  buildPlayerStates,
  normaliseGames,
  scoreGroups,
} from './utilities.js';

import type { PairOptions } from './trace.js';
import type { Game, PairingResult, Player } from './types.js';
import type { PlayerState } from './utilities.js';
import type { BracketContext, Criterion } from './weights.js';

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
]; // ---------------------------------------------------------------------------
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

  if (trace && byeId !== undefined) {
    trace({
      playerId: byeId,
      reason: 'lowest-score-no-prior-bye',
      system: 'lim',
      type: 'pairing:bye-assigned',
    });
  }

  // Remove bye recipient from the pairing pool
  const pairedPool =
    byeId === undefined ? sorted : sorted.filter((s) => s.id !== byeId);

  // Precompute score-group params once
  const sgParameters = computeScoreGroupParameters(pairedPool);
  const groupPositions = buildGroupPositions(pairedPool);
  const groupSizes = buildGroupSizes(pairedPool);

  if (trace) {
    const sgMap = scoreGroups(pairedPool);
    const groups: { playerIds: string[]; score: number }[] = [];
    for (const [score, members] of sgMap) {
      groups.push({ playerIds: members.map((m) => m.id), score });
    }
    trace({ groups, system: 'lim', type: 'pairing:score-groups' });
  }

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

  const edges = buildBlossomEdges(pairedPool, LIM_CRITERIA, globalContext);
  const matching = runBlossom(pairedPool, edges, 'lim', true, trace);

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
          system: 'lim',
          type: 'pairing:pair-finalized',
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Allocate colours
  // -------------------------------------------------------------------------
  const pairings = allPairedTuples.map(([a, b]) =>
    allocateColor(a, b, FIDE_COLOR_RULES, limRankCompare),
  );

  if (trace) {
    for (const p of pairings) {
      trace({
        black: p.black,
        rule: 'lim-article-5.2',
        system: 'lim',
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
