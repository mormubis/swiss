/**
 * FIDE Dutch System pairing (C.04.3) — bracket-by-bracket blossom matching.
 *
 * Implements the full bbpPairings `computeMatching` algorithm:
 * 1. Build PlayerState for every player. Sort by score DESC, TPN ASC.
 * 2. Compute score-group parameters (scoreGroupSizeBits, scoreGroupShifts,
 *    scoreGroupsShift).
 * 3. Feasibility pass (odd player count): determine byeAssigneeScore,
 *    isSingleDownfloaterByeAssignee, unplayedGameRanks.
 * 4. Bracket-by-bracket blossom:
 *    a. Add next score group players to playersByIndex.
 *    b. Compute baseEdgeWeights for all pairs.
 *    c. Run blossom.
 *    d. MDP selection: for each downfloater, confirm or boost and re-run.
 *    e. Finalize MDP pairs.
 *    f. Remainder: add exchange ordering bits, select exchanges, finalize.
 *    g. Carry unmatched players as downfloaters to next bracket.
 * 5. Allocate colours (Article 5.2). Assign bye.
 */

import { maxWeightMatching } from './blossom.js';
import { DynamicUint } from './dynamic-uint.js';
import { MatchingComputer } from './matching-computer.js';
import {
  allocateColor,
  assignBye,
  buildPlayerStates,
  scoreGroups,
} from './utilities.js';

import type { PairOptions } from './trace.js';
import type { Game, PairingResult, Player } from './types.js';
import type { ColorRule, PlayerState } from './utilities.js';

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
  (hrp, opp) => {
    const hrpS = rankPreference(hrp.preferenceStrength);
    const oppS = rankPreference(opp.preferenceStrength);
    if (hrpS > oppS && hrp.preferredColor !== undefined) {
      return hrp.preferredColor === 'white' ? 'hrp-white' : 'hrp-black';
    }
    if (oppS > hrpS && opp.preferredColor !== undefined) {
      return opp.preferredColor === 'white' ? 'hrp-black' : 'hrp-white';
    }
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
  (hrp) => {
    if (hrp.preferredColor !== undefined) {
      return hrp.preferredColor === 'white' ? 'hrp-white' : 'hrp-black';
    }
    return 'continue';
  },
  (hrp) => (hrp.tpn % 2 === 1 ? 'hrp-white' : 'hrp-black'),
];

function dutchRankCompare(a: PlayerState, b: PlayerState): number {
  return a.tpn - b.tpn;
}

function dutchByeTiebreak(a: PlayerState, b: PlayerState): number {
  if (a.unplayedRounds !== b.unplayedRounds)
    return a.unplayedRounds - b.unplayedRounds;
  return b.tpn - a.tpn;
}

// ---------------------------------------------------------------------------
// Score-group parameters
// ---------------------------------------------------------------------------

function bitsToRepresent(n: number): number {
  if (n <= 1) return 1;
  return Math.ceil(Math.log2(n + 1));
}

interface ScoreGroupParameters {
  scoreGroupShifts: Map<number, number>;
  scoreGroupSizeBits: number;
  scoreGroupsShift: number;
}

function computeScoreGroupParameters(
  states: PlayerState[],
): ScoreGroupParameters {
  const groups = scoreGroups(states);
  let maxSize = 0;
  for (const [, m] of groups) if (m.length > maxSize) maxSize = m.length;
  const scoreGroupSizeBits = Math.max(1, bitsToRepresent(maxSize));
  const sortedScores = [...groups.keys()].toSorted((a, b) => a - b);
  const scoreGroupShifts = new Map<number, number>();
  let offset = 0;
  for (const sc of sortedScores) {
    scoreGroupShifts.set(sc, offset);
    offset += Math.max(1, bitsToRepresent(groups.get(sc)?.length ?? 0));
  }
  return {
    scoreGroupShifts,
    scoreGroupSizeBits,
    scoreGroupsShift: Math.max(1, offset),
  };
}

// ---------------------------------------------------------------------------
// Float direction
// ---------------------------------------------------------------------------

type FloatDirection = 'down' | 'none' | 'up';

function getFloat(player: PlayerState, roundsBack: number): FloatDirection {
  const index = player.floatHistory.length - roundsBack;
  if (index < 0) return 'none';
  const f = player.floatHistory[index];
  return f === 'down' ? 'down' : f === 'up' ? 'up' : 'none';
}

// ---------------------------------------------------------------------------
// Color predicates
// ---------------------------------------------------------------------------

function absoluteColorImbalance(p: PlayerState): boolean {
  return Math.abs(p.colorDiff) > 1;
}

function absoluteColorPreference(p: PlayerState): boolean {
  return p.preferenceStrength === 'absolute';
}

function strongColorPreference(p: PlayerState): boolean {
  return (
    p.preferenceStrength === 'strong' || p.preferenceStrength === 'absolute'
  );
}

function colorPreferencesAreCompatible(
  a: PlayerState,
  b: PlayerState,
): boolean {
  return (
    a.preferredColor === undefined ||
    b.preferredColor === undefined ||
    a.preferredColor !== b.preferredColor
  );
}

function repeatedColor(p: PlayerState): 'black' | 'white' | undefined {
  const hist = p.colorHistory.filter(
    (c): c is 'black' | 'white' => c !== undefined,
  );
  if (hist.length < 2) return undefined;
  const last = hist.at(-1);
  const previous = hist.at(-2);
  if (last === undefined || previous === undefined) return undefined;
  return last === previous ? last : undefined;
}

function invertColor(
  c: 'black' | 'white' | undefined,
): 'black' | 'white' | undefined {
  if (c === 'white') return 'black';
  if (c === 'black') return 'white';
  return undefined;
}

// ---------------------------------------------------------------------------
// Compatibility (C1 + C3)
// ---------------------------------------------------------------------------

function compatible(
  a: PlayerState,
  b: PlayerState,
  playedRounds: number,
  expectedRounds: number,
): boolean {
  if (a.opponents.has(b.id)) return false;
  if (
    a.preferenceStrength === 'absolute' &&
    b.preferenceStrength === 'absolute' &&
    a.preferredColor !== undefined &&
    b.preferredColor !== undefined &&
    a.preferredColor === b.preferredColor
  ) {
    const topThreshold = playedRounds / 2;
    const aTop = a.score > topThreshold;
    const bTop = b.score > topThreshold;
    if (!(playedRounds >= expectedRounds - 1 && (aTop || bTop))) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// isByeCandidate
// ---------------------------------------------------------------------------

function isByeCandidate(p: PlayerState, byeAssigneeScore: number): boolean {
  return p.byeCount === 0 && p.score <= byeAssigneeScore;
}

// ---------------------------------------------------------------------------
// DynamicUint bit helpers
// ---------------------------------------------------------------------------

function orBitAt(w: DynamicUint, shift: number, useAdd: boolean): void {
  if (shift < 32) {
    const bit = 1 << shift;
    if (useAdd) w.add(bit);
    else w.or(bit);
  } else {
    const b = DynamicUint.from(1);
    b.shiftGrow(shift);
    if (useAdd) w.add(b);
    else w.or(b);
  }
}

// ---------------------------------------------------------------------------
// computeEdgeWeight — exact bbpPairings weight layout
// ---------------------------------------------------------------------------

function computeEdgeWeight(
  hi: PlayerState,
  lo: PlayerState,
  lowerInCurrent: boolean,
  lowerInNext: boolean,
  byeAssigneeScore: number,
  playedRounds: number,
  expectedRounds: number,
  sgp: ScoreGroupParameters,
  isSingleDownfloaterByeAssignee: boolean,
  unplayedGameRanks: Map<number, number>,
): DynamicUint {
  if (!compatible(hi, lo, playedRounds, expectedRounds)) {
    return DynamicUint.from(0);
  }

  const { scoreGroupShifts, scoreGroupSizeBits, scoreGroupsShift } = sgp;
  const w = DynamicUint.from(0);

  // Compatibility + bye eligibility
  w.or(
    1 +
      (isByeCandidate(hi, byeAssigneeScore) ? 0 : 1) +
      (isByeCandidate(lo, byeAssigneeScore) ? 0 : 1),
  );

  // C6
  w.shiftGrow(scoreGroupSizeBits);
  if (lowerInCurrent) w.or(1);

  // C7
  w.shiftGrow(scoreGroupsShift);
  if (lowerInCurrent) {
    orBitAt(w, scoreGroupShifts.get(hi.score) ?? 0, false);
  }

  // C8
  w.shiftGrow(scoreGroupSizeBits);
  if (lowerInNext) w.or(1);

  // C8b
  w.shiftGrow(scoreGroupsShift);
  if (lowerInNext) {
    orBitAt(w, scoreGroupShifts.get(hi.score) ?? 0, false);
  }

  // C9
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);
  if (isSingleDownfloaterByeAssignee) {
    if (hi.score === byeAssigneeScore) {
      w.or(unplayedGameRanks.get(hi.unplayedRounds) ?? 0);
    }
    if (lo.score === byeAssigneeScore) {
      w.add(unplayedGameRanks.get(lo.unplayedRounds) ?? 0);
    }
  }

  // C10–C13 (player=lo, opponent=hi per bbpPairings insertColorBits)

  // C10
  w.shiftGrow(scoreGroupSizeBits);
  if (
    lowerInCurrent &&
    (!absoluteColorImbalance(lo) ||
      !absoluteColorImbalance(hi) ||
      lo.preferredColor !== hi.preferredColor)
  )
    w.or(1);

  // C11
  w.shiftGrow(scoreGroupSizeBits);
  if (lowerInCurrent) {
    const loCI = lo.colorDiff;
    const hiCI = hi.colorDiff;
    const ok =
      !absoluteColorPreference(lo) ||
      !absoluteColorPreference(hi) ||
      lo.preferredColor !== hi.preferredColor ||
      (loCI === hiCI
        ? repeatedColor(lo) === undefined ||
          repeatedColor(lo) !== repeatedColor(hi)
        : (loCI > hiCI ? hi : lo).preferredColor !==
          invertColor(lo.preferredColor));
    if (ok) w.or(1);
  }

  // C12
  w.shiftGrow(scoreGroupSizeBits);
  if (lowerInCurrent && colorPreferencesAreCompatible(lo, hi)) w.or(1);

  // C13
  w.shiftGrow(scoreGroupSizeBits);
  if (
    lowerInCurrent &&
    ((!strongColorPreference(lo) && !absoluteColorPreference(lo)) ||
      (!strongColorPreference(hi) && !absoluteColorPreference(hi)) ||
      (absoluteColorPreference(lo) && absoluteColorPreference(hi)) ||
      lo.preferredColor !== hi.preferredColor)
  )
    w.or(1);

  // C14–C17
  if (playedRounds >= 1) {
    w.shiftGrow(scoreGroupSizeBits); // C14
    if (lowerInCurrent) {
      if (getFloat(lo, 1) === 'down') w.or(1);
      if (hi.score <= lo.score && getFloat(hi, 1) === 'down') w.add(1);
    }
    w.shiftGrow(scoreGroupSizeBits); // C15
    if (lowerInCurrent && !(hi.score > lo.score && getFloat(lo, 1) === 'up'))
      w.or(1);
  }
  if (playedRounds > 1) {
    w.shiftGrow(scoreGroupSizeBits); // C16
    if (lowerInCurrent) {
      if (getFloat(lo, 2) === 'down') w.or(1);
      if (hi.score <= lo.score && getFloat(hi, 2) === 'down') w.add(1);
    }
    w.shiftGrow(scoreGroupSizeBits); // C17
    if (lowerInCurrent && !(hi.score > lo.score && getFloat(lo, 2) === 'up'))
      w.or(1);
  }

  // C18–C21
  if (playedRounds >= 1) {
    w.shiftGrow(scoreGroupsShift); // C18
    if (lowerInCurrent) {
      if (getFloat(lo, 1) === 'down')
        orBitAt(w, scoreGroupShifts.get(lo.score) ?? 0, true);
      if (getFloat(hi, 1) === 'down')
        orBitAt(w, scoreGroupShifts.get(hi.score) ?? 0, true);
    }
    w.shiftGrow(scoreGroupsShift); // C19
    if (lowerInCurrent && !(getFloat(lo, 1) === 'up' && hi.score > lo.score)) {
      orBitAt(w, scoreGroupShifts.get(hi.score) ?? 0, false);
    }
  }
  if (playedRounds > 1) {
    w.shiftGrow(scoreGroupsShift); // C20
    if (lowerInCurrent) {
      if (getFloat(lo, 2) === 'down')
        orBitAt(w, scoreGroupShifts.get(lo.score) ?? 0, true);
      if (getFloat(hi, 2) === 'down')
        orBitAt(w, scoreGroupShifts.get(hi.score) ?? 0, true);
    }
    w.shiftGrow(scoreGroupsShift); // C21
    if (lowerInCurrent && !(getFloat(lo, 2) === 'up' && hi.score > lo.score)) {
      orBitAt(w, scoreGroupShifts.get(hi.score) ?? 0, false);
    }
  }

  // Ordering slots (3 × scoreGroupSizeBits — zero)
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);

  // Finalization flag (1 bit — zero)
  w.shiftGrow(1);

  return w;
}

// ---------------------------------------------------------------------------
// computeMaxEdgeWeight — upper bound on any edge weight (max=true variant)
// ---------------------------------------------------------------------------

function computeMaxEdgeWeight(sgp: ScoreGroupParameters): DynamicUint {
  const { scoreGroupSizeBits, scoreGroupsShift } = sgp;
  const w = DynamicUint.from(0);

  // Compatibility + bye: max = 2
  w.or(2);

  // C6
  w.shiftGrow(scoreGroupSizeBits);
  // C7
  w.shiftGrow(scoreGroupsShift);
  // C8
  w.shiftGrow(scoreGroupSizeBits);
  // C8b
  w.shiftGrow(scoreGroupsShift);
  // C9 (2 slots)
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);
  // C10–C13 (4 slots)
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);

  // C14–C17 (up to 4 slots)
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);

  // C18–C21 (up to 4 slots)
  w.shiftGrow(scoreGroupsShift);
  w.shiftGrow(scoreGroupsShift);
  w.shiftGrow(scoreGroupsShift);
  w.shiftGrow(scoreGroupsShift);

  // Ordering slots (3 × scoreGroupSizeBits)
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);
  w.shiftGrow(scoreGroupSizeBits);

  // Finalization flag (1 bit)
  w.shiftGrow(1);

  // Extra 2 bits for blossom subroutine headroom, then subtract 1 to set all bits
  w.shiftGrow(2);
  w.shiftRight(1);
  w.subtract(1);

  return w;
}

// ---------------------------------------------------------------------------
// Feasibility weight (odd count)
// ---------------------------------------------------------------------------

function buildFeasibilityWeight(
  hi: PlayerState,
  lo: PlayerState,
  topScore: number,
  playedRounds: number,
  expectedRounds: number,
  sgp: ScoreGroupParameters,
): DynamicUint {
  if (!compatible(hi, lo, playedRounds, expectedRounds)) {
    return DynamicUint.from(0);
  }
  const { scoreGroupShifts, scoreGroupSizeBits, scoreGroupsShift } = sgp;
  const w = DynamicUint.from(0);
  w.or(1 + (hi.byeCount === 0 ? 0 : 1) + (lo.byeCount === 0 ? 0 : 1));
  w.shiftGrow(scoreGroupsShift);
  w.or(
    (scoreGroupShifts.get(hi.score) ?? 0) +
      (scoreGroupShifts.get(lo.score) ?? 0),
  );
  w.shiftGrow(scoreGroupSizeBits);
  if (hi.score >= topScore) w.or(1);
  return w;
}

// ---------------------------------------------------------------------------
// finalizePairMC — set edge (v1,v2) to 1, zero all other edges for v1 and v2
// ---------------------------------------------------------------------------

function finalizePairMC(
  v1: number,
  v2: number,
  mc: MatchingComputer,
  np: number,
): void {
  const one = DynamicUint.from(1);
  const zero = DynamicUint.from(0);
  for (let index = 0; index < np; index++) {
    if (index !== v1 && index !== v2) {
      mc.setEdgeWeight(v1, index, zero.clone());
      mc.setEdgeWeight(v2, index, zero.clone());
    }
  }
  mc.setEdgeWeight(v1, v2, one);
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
  const playedRounds = games.length;
  const expectedRounds = playedRounds + 1;
  const states = buildPlayerStates(players, games);

  // Sort: score DESC, TPN ASC
  const sorted = [...states].toSorted((a, b) =>
    a.score === b.score ? a.tpn - b.tpn : b.score - a.score,
  );

  const needsBye = sorted.length % 2 === 1;
  const sgp = computeScoreGroupParameters(sorted);
  const n = sorted.length;

  // -------------------------------------------------------------------------
  // Phase 1: Feasibility (odd count) → byeAssigneeScore
  // -------------------------------------------------------------------------
  let byeAssigneeScore = 0;
  let isSingleDownfloaterByeAssignee = false;
  const unplayedGameRanks = new Map<number, number>();

  if (needsBye) {
    const topScore = sorted[0]?.score ?? 0;
    const feasEdges: [number, number, DynamicUint][] = [];
    for (let index = 0; index < n; index++) {
      for (let index_ = 0; index_ < index; index_++) {
        const hiPlayer = sorted[index_];
        const loPlayer = sorted[index];
        if (hiPlayer === undefined || loPlayer === undefined) continue;
        const w = buildFeasibilityWeight(
          hiPlayer,
          loPlayer,
          topScore,
          playedRounds,
          expectedRounds,
          sgp,
        );
        if (!w.isZero()) feasEdges.push([index_, index, w]);
      }
    }

    if (trace) {
      trace({
        edgeCount: feasEdges.length,
        phase: 'feasibility',
        system: 'dutch',
        type: 'pairing:blossom-invoked',
        vertexCount: n,
      });
    }
    const m0 = maxWeightMatching(feasEdges, true, trace);
    if (trace) {
      const pairs: [string, string][] = [];
      let unmatchedCount = 0;
      for (const [k, element] of m0.entries()) {
        const mk = element ?? -1;
        if (mk > k) {
          const aState = sorted[k];
          const bState = sorted[mk];
          if (aState && bState) pairs.push([aState.id, bState.id]);
        } else if (mk === -1 || mk === k) {
          unmatchedCount++;
        }
      }
      trace({
        pairs,
        phase: 'feasibility',
        system: 'dutch',
        type: 'pairing:blossom-result',
        unmatchedCount,
      });
    }

    for (let index = 0; index < n; index++) {
      const mi = m0[index] ?? -1;
      if (mi < 0 || mi === index) {
        byeAssigneeScore = sorted[index]?.score ?? 0;
        break;
      }
    }

    if (byeAssigneeScore >= topScore) {
      isSingleDownfloaterByeAssignee = true;
      for (let index = 0; index < n; index++) {
        if ((sorted[index]?.score ?? -1) < topScore) break;
        const mi = m0[index] ?? -1;
        if (mi < 0 || mi === index) continue;
        if ((sorted[mi]?.score ?? -1) < topScore) {
          isSingleDownfloaterByeAssignee = false;
          break;
        }
      }
    }

    const byePlayers = sorted
      .filter((s) => s.score === byeAssigneeScore)
      .toSorted((a, b) => a.unplayedRounds - b.unplayedRounds);
    let rank = 0;
    const seenUnplayed = new Map<number, number>();
    for (const p of byePlayers) {
      if (!seenUnplayed.has(p.unplayedRounds)) {
        seenUnplayed.set(p.unplayedRounds, rank++);
      }
    }
    for (const [k, v] of seenUnplayed) {
      unplayedGameRanks.set(k, v);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Bye assignee
  // -------------------------------------------------------------------------
  let byeState: PlayerState | undefined;
  if (needsBye) {
    byeState = assignBye(sorted, games, dutchByeTiebreak);
  }
  const byeId = byeState?.id;
  if (trace && byeId !== undefined) {
    trace({
      playerId: byeId,
      reason: 'lowest-score-no-prior-bye',
      system: 'dutch',
      type: 'pairing:bye-assigned',
    });
  }
  const pairedSorted =
    byeId === undefined ? sorted : sorted.filter((s) => s.id !== byeId);
  const np = pairedSorted.length;

  if (np < 2) {
    return {
      byes: byeId === undefined ? [] : [{ player: byeId }],
      pairings: [],
    };
  }

  // -------------------------------------------------------------------------
  // Phase 3: Score group membership
  // -------------------------------------------------------------------------
  const sgMap = scoreGroups(pairedSorted);
  if (trace) {
    const groups: { playerIds: string[]; score: number }[] = [];
    for (const [score, members] of sgMap) {
      groups.push({ playerIds: members.map((m) => m.id), score });
    }
    trace({ groups, system: 'dutch', type: 'pairing:score-groups' });
  }
  const scoreLevels = [...sgMap.keys()].toSorted((a, b) => b - a); // desc

  // Score groups as arrays of indices into pairedSorted, ordered by score desc
  const scoreGroupArrays: number[][] = scoreLevels.map((sc) => {
    const members = sgMap.get(sc) ?? [];
    return members.map((p) => pairedSorted.findIndex((s) => s.id === p.id));
  });

  // -------------------------------------------------------------------------
  // Phase 4: Initialize MatchingComputer + maxEdgeWeight
  // -------------------------------------------------------------------------
  const maxEdgeWeight = computeMaxEdgeWeight(sgp);

  // Persistent matching computer, populated per-bracket with correct weights.
  const mc = new MatchingComputer(maxEdgeWeight);
  for (let index = 0; index < np; index++) mc.addVertex();

  // -------------------------------------------------------------------------
  // Phase 5: Bracket-by-bracket processing
  // -------------------------------------------------------------------------

  /**
   * matchedPairs: global list of finalized pairings (indices into pairedSorted)
   */
  const matchedPairs: [number, number][] = [];

  /**
   * matched[i] = true when player i has been finalized
   */
  const matched: boolean[] = Array.from({ length: np }, () => false);

  /**
   * playersByIndex: local indices of active players in the current bracket pass.
   * MDPs (downfloaters) come first (indices 0..scoreGroupBegin-1),
   * then the current score group's players.
   */
  let playersByIndex: number[] = []; // indices into pairedSorted
  let scoreGroupBegin = 0; // how many MDPs are in playersByIndex

  // Initialize with the top score group
  const firstGroup = scoreGroupArrays[0] ?? [];
  playersByIndex = [...firstGroup];

  let sgIterator = 1; // index into scoreGroupArrays for the NEXT group

  // We need scoreGroupBeginVertex for the C++ algorithm:
  // "index in sortedPlayers of the first player in current score group"
  // In our case, pairedSorted IS sortedPlayers, so vertexIndices[i] = playersByIndex[i]
  // scoreGroupBeginVertex tracks the global vertex index of start of current bracket's score group
  let scoreGroupBeginVertex = 0; // starts at 0 (first group begins at 0 in pairedSorted)

  let currentPhase = 'bracket';
  let bracketIterCount = 0;
  while (playersByIndex.length > 1 || sgIterator < scoreGroupArrays.length) {
    if (++bracketIterCount > np * 10) break; // safety guard: prevents infinite loops

    // nextScoreGroupBegin: number of players in playersByIndex before adding next group
    const nextScoreGroupBegin = playersByIndex.length;
    // nextScoreGroupBeginVertex: global index in pairedSorted where next score group starts
    const nextScoreGroupBeginVertex =
      scoreGroupBeginVertex + (nextScoreGroupBegin - scoreGroupBegin);

    // Add next score group to playersByIndex
    if (sgIterator < scoreGroupArrays.length) {
      const nextGroup = scoreGroupArrays[sgIterator] ?? [];
      for (const index of nextGroup) {
        playersByIndex.push(index);
      }
      sgIterator++;
    }

    // When all score groups are exhausted and no new group was added, the
    // remaining players are downfloaters that could not be paired in any
    // bracket. Break out and let the fallback code handle them.
    if (
      nextScoreGroupBegin === scoreGroupBegin &&
      playersByIndex.length === scoreGroupBegin
    ) {
      break;
    }

    if (trace) {
      const bracketScore =
        pairedSorted[playersByIndex[scoreGroupBegin] ?? 0]?.score ?? 0;
      const mdpIds = playersByIndex
        .slice(0, scoreGroupBegin)
        .map((gi) => pairedSorted[gi]?.id ?? '');
      const playerIds = playersByIndex.map((gi) => pairedSorted[gi]?.id ?? '');
      trace({
        bracketScore,
        mdpIds,
        playerIds,
        type: 'dutch:bracket-enter',
      });
    }

    // Compute baseEdgeWeights for all pairs involving the current/next bracket.
    // baseEdgeWeights[largerLocalIdx][smallerLocalIdx]
    const baseEdgeWeights: (DynamicUint | undefined)[][] = Array.from(
      { length: playersByIndex.length },
      () => [],
    );

    // Reset MDP-MDP edges in the matrix: pairs where both players are MDPs
    // (both local < scoreGroupBegin) retain stale high weights from prior
    // brackets. Reset them with fresh weights (lowerInCurrent=false,
    // lowerInNext=false) to prevent MDPs from incorrectly pairing together.
    for (
      let largerLocalIndex = 1;
      largerLocalIndex < scoreGroupBegin;
      largerLocalIndex++
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const largerGlobal = playersByIndex[largerLocalIndex]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const loPlayer = pairedSorted[largerGlobal]!;
      for (
        let smallerLocalIndex = 0;
        smallerLocalIndex < largerLocalIndex;
        smallerLocalIndex++
      ) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const smallerGlobal = playersByIndex[smallerLocalIndex]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const hiPlayer = pairedSorted[smallerGlobal]!;
        const w = computeEdgeWeight(
          hiPlayer,
          loPlayer,
          false, // lowerInCurrent: neither MDP is in the current bracket
          false, // lowerInNext: neither is in the next score group
          byeAssigneeScore,
          playedRounds,
          expectedRounds,
          sgp,
          isSingleDownfloaterByeAssignee,
          unplayedGameRanks,
        );
        mc.setEdgeWeight(largerGlobal, smallerGlobal, w);
      }
    }

    for (
      let largerLocalIndex = scoreGroupBegin;
      largerLocalIndex < playersByIndex.length;
      largerLocalIndex++
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const largerGlobal = playersByIndex[largerLocalIndex]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const loPlayer = pairedSorted[largerGlobal]!;

      for (
        let smallerLocalIndex = 0;
        smallerLocalIndex < largerLocalIndex;
        smallerLocalIndex++
      ) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const smallerGlobal = playersByIndex[smallerLocalIndex]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const hiPlayer = pairedSorted[smallerGlobal]!;

        // lowerPlayerInCurrentBracket: largerLocalIdx < nextScoreGroupBegin
        const lowerInCurrent = largerLocalIndex < nextScoreGroupBegin;
        // lowerPlayerInNextBracket: largerLocalIdx >= nextScoreGroupBegin
        const lowerInNext = largerLocalIndex >= nextScoreGroupBegin;

        const w = computeEdgeWeight(
          hiPlayer,
          loPlayer,
          lowerInCurrent,
          lowerInNext,
          byeAssigneeScore,
          playedRounds,
          expectedRounds,
          sgp,
          isSingleDownfloaterByeAssignee,
          unplayedGameRanks,
        );

        (baseEdgeWeights[largerLocalIndex] as (DynamicUint | undefined)[])[
          smallerLocalIndex
        ] = w;

        // Update the persistent matching computer
        mc.setEdgeWeight(largerGlobal, smallerGlobal, w);
      }
    }

    // Helper: run matching computer on current playersByIndex
    const runBlossom = (): number[] => {
      if (trace) {
        // Count non-zero edges for trace
        let edgeCount = 0;
        for (let ii = 0; ii < playersByIndex.length; ii++) {
          for (let jj = 0; jj < ii; jj++) {
            edgeCount++;
          }
        }
        trace({
          edgeCount,
          phase: currentPhase,
          system: 'dutch',
          type: 'pairing:blossom-invoked',
          vertexCount: playersByIndex.length,
        });
      }
      mc.computeMatching();
      const rawMatching = mc.getMatching();
      // Normalize: self-match → -1
      const stableM = [...rawMatching];
      for (let index = 0; index < stableM.length; index++) {
        if (stableM[index] === index) stableM[index] = -1;
      }
      if (trace) {
        const pairs: [string, string][] = [];
        let unmatchedCount = 0;
        for (const [k, element] of stableM.entries()) {
          const mk = element ?? -1;
          if (mk > k) {
            const aState = pairedSorted[k];
            const bState = pairedSorted[mk];
            if (aState && bState) pairs.push([aState.id, bState.id]);
          } else if (mk === -1 || mk === k) {
            unmatchedCount++;
          }
        }
        trace({
          pairs,
          phase: currentPhase,
          system: 'dutch',
          type: 'pairing:blossom-result',
          unmatchedCount,
        });
      }
      return stableM;
    };

    // edgeWeightComputer — mimics bbpPairings' lambda
    // Adds ordering bits to baseEdgeWeight.
    //
    // In bbpPairings, addend = (result & 0u) which makes addend the SAME fixed
    // width as result. Unsigned arithmetic wraps within that width. We replicate
    // this by building addend in the same number of words as result (base).
    const edgeWeightComputer = (
      smallerLocalIndex: number,
      largerLocalIndex: number,
      smallerPlayerRemainderIndex: number,
      remainderPairs: number,
    ): DynamicUint => {
      const base = (
        baseEdgeWeights[largerLocalIndex] as (DynamicUint | undefined)[]
      )[smallerLocalIndex];
      if (base === undefined || base.isZero()) return DynamicUint.from(0);

      const result = base.clone();

      // addend has the same word-width as result (mirrors C++ "result & 0u")
      const resultWords = result.words;
      const addend = DynamicUint.zero(resultWords);

      // Minimize the number of exchanges
      const exchangeBit = smallerPlayerRemainderIndex < remainderPairs ? 1 : 0;
      addend.or(exchangeBit);

      // Minimize difference of exchanged BSNs:
      // addend <<= 2*scoreGroupSizeBits; addend -= smallerPlayerRemainderIndex;
      // When exchangeBit=0 this underflows and wraps within resultWords bits.
      addend.shiftLeft(sgp.scoreGroupSizeBits * 2);
      // Subtract (wrapping within resultWords words — same as C++ fixed-width unsigned)
      // DynamicUint.subtract naturally wraps within available words.
      addend.subtract(smallerPlayerRemainderIndex);

      // Leave room for optimizing which players are exchanged
      addend.shiftLeft(1);
      // Truncate to resultWords words (mirrors C++ fixed-width: discard overflow)
      // Since shiftLeft may produce high bits, we simply ignore them — DynamicUint
      // keeps extra words only if shiftGrow was used; shiftLeft does not grow.
      // So addend is already bounded to resultWords words.

      result.add(addend);
      return result;
    };

    // Run initial blossom
    currentPhase = 'bracket-initial';
    let stableMatching = runBlossom();

    // -----------------------------------------------------------------------
    // MDP selection: choose which downfloaters to pair in this bracket
    // -----------------------------------------------------------------------

    // Process MDPs by score group (score descending among MDPs)
    // bbpPairings iterates playerIndex from 0..scoreGroupBegin-1
    // grouped by score (movedDownScoreGroup)

    let mdpIndex = 0;
    while (mdpIndex < scoreGroupBegin) {
      const mdpScore =
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        pairedSorted[playersByIndex[mdpIndex]!]?.score ?? -1;

      // Count MDPs in this score group and how many are matched to current bracket
      let remainingMDPs = 0;
      let remainingMatchedMDPs = 0;
      let endIndex = mdpIndex;
      while (
        endIndex < scoreGroupBegin &&
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        (pairedSorted[playersByIndex[endIndex]!]?.score ?? -1) >= mdpScore
      ) {
        remainingMDPs++;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const mdpGlobal = playersByIndex[endIndex]!;
        const matchedGlobal = stableMatching[mdpGlobal] ?? -1;
        // Check if matched to a player in the current bracket's score group
        // (i.e., between scoreGroupBeginVertex and nextScoreGroupBeginVertex in pairedSorted)
        if (
          matchedGlobal >= scoreGroupBeginVertex &&
          matchedGlobal < nextScoreGroupBeginVertex
        ) {
          remainingMatchedMDPs++;
        }
        endIndex++;
      }

      // Process each MDP in this score group
      for (let pi = mdpIndex; pi < endIndex; pi++) {
        if (remainingMatchedMDPs === 0) break;

        const playerLocal = pi;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const playerGlobal = playersByIndex[playerLocal]!;

        if (remainingMDPs <= remainingMatchedMDPs) {
          // All remaining MDPs can be matched — mark as will-be-matched
          matched[playerGlobal] = true;
          remainingMDPs--;
          remainingMatchedMDPs--;
          continue;
        }

        remainingMDPs--;

        const currentMatch = stableMatching[playerGlobal] ?? -1;
        const currentlyMatchedToBracket =
          currentMatch >= scoreGroupBeginVertex &&
          currentMatch < nextScoreGroupBeginVertex;

        if (!currentlyMatchedToBracket) {
          // Try to match by boosting edges to current bracket members
          for (
            let opponentLocal = scoreGroupBegin;
            opponentLocal < nextScoreGroupBegin;
            opponentLocal++
          ) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentGlobal = playersByIndex[opponentLocal]!;
            const base = (
              baseEdgeWeights[opponentLocal] as (DynamicUint | undefined)[]
            )[playerLocal];
            if (base !== undefined && !base.isZero()) {
              const boosted = base.clone();
              boosted.or(1); // set finalization bit
              mc.setEdgeWeight(playerGlobal, opponentGlobal, boosted);
            }
          }

          currentPhase = 'bracket-mdp';
          stableMatching = runBlossom();
        }

        const newMatch = stableMatching[playerGlobal] ?? -1;
        const nowMatchedToBracket =
          newMatch >= scoreGroupBeginVertex &&
          newMatch < nextScoreGroupBeginVertex;

        if (nowMatchedToBracket) {
          // Finalize that this MDP will be matched
          matched[playerGlobal] = true;
          remainingMatchedMDPs--;

          // Boost edges from this MDP to current bracket by bracket size
          for (
            let opponentLocal = scoreGroupBegin;
            opponentLocal < nextScoreGroupBegin;
            opponentLocal++
          ) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentGlobal = playersByIndex[opponentLocal]!;
            const base = (
              baseEdgeWeights[opponentLocal] as (DynamicUint | undefined)[]
            )[playerLocal];
            if (base !== undefined && !base.isZero()) {
              const boosted = base.clone();
              boosted.or(nextScoreGroupBegin - scoreGroupBegin);
              boosted.add(1);
              mc.setEdgeWeight(playerGlobal, opponentGlobal, boosted);
            }
          }
        }
      }

      mdpIndex = endIndex;
    }

    // -----------------------------------------------------------------------
    // Choose opponents of MDPs (finalize MDP pairings)
    // -----------------------------------------------------------------------
    for (let playerLocal = 0; playerLocal < scoreGroupBegin; playerLocal++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const playerGlobal = playersByIndex[playerLocal]!;
      if (!matched[playerGlobal]) continue;

      // Boost edges by priority: earlier opponents (lower index in bracket) get more weight
      // bbpPairings iterates opponentIndex from nextScoreGroupBegin-1 down to scoreGroupBegin
      let addend = playersByIndex.length; // starts at total player count in bracket
      for (
        let opponentLocal = nextScoreGroupBegin - 1;
        opponentLocal >= scoreGroupBegin;
        opponentLocal--
      ) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const opponentGlobal = playersByIndex[opponentLocal]!;
        if (matched[opponentGlobal]) continue;

        const base = (
          baseEdgeWeights[opponentLocal] as (DynamicUint | undefined)[]
        )[playerLocal];
        if (base !== undefined && !base.isZero()) {
          const boosted = base.clone();
          boosted.add(addend);
          mc.setEdgeWeight(playerGlobal, opponentGlobal, boosted);
          addend++;
        }
      }

      currentPhase = 'bracket-mdp-finalize';
      stableMatching = runBlossom();

      // Finalize the pairing
      const matchGlobal = stableMatching[playerGlobal] ?? -1;
      if (matchGlobal >= 0 && matchGlobal !== playerGlobal) {
        matched[matchGlobal] = true;
        finalizePairMC(playerGlobal, matchGlobal, mc, np);
        matchedPairs.push([playerGlobal, matchGlobal]);
        if (trace) {
          trace({
            phase: currentPhase,
            playerA: pairedSorted[playerGlobal]?.id ?? '',
            playerB: pairedSorted[matchGlobal]?.id ?? '',
            system: 'dutch',
            type: 'pairing:pair-finalized',
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Build remainder: players in current bracket not matched to MDPs
    // -----------------------------------------------------------------------

    // Re-run blossom after MDP finalizations
    currentPhase = 'bracket-remainder';
    stableMatching = runBlossom();

    // remainder: local indices of players in scoreGroupBegin..nextScoreGroupBegin
    // that are not matched to MDPs (i.e., their match is not below scoreGroupBeginVertex)
    const remainder: number[] = [];
    let remainderPairs = 0;

    for (
      let playerLocal = scoreGroupBegin;
      playerLocal < nextScoreGroupBegin;
      playerLocal++
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const playerGlobal = playersByIndex[playerLocal]!;
      const matchGlobal = stableMatching[playerGlobal] ?? -1;

      // Skip if matched to an MDP (match is below scoreGroupBeginVertex)
      if (matchGlobal >= 0 && matchGlobal < scoreGroupBeginVertex) {
        continue;
      }

      remainder.push(playerLocal);
      // If match is within the current bracket (same score group, smaller index)
      if (matchGlobal >= 0 && matchGlobal < playerGlobal) {
        remainderPairs++;
      }
    }

    // -----------------------------------------------------------------------
    // Remainder: apply edgeWeightComputer ordering bits
    // -----------------------------------------------------------------------

    // Update edge weights with ordering preferences (exchange minimization).
    for (let opIndex = 0; opIndex < remainder.length; opIndex++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const opponentLocal = remainder[opIndex]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const opponentGlobal = playersByIndex[opponentLocal]!;
      let playerRemainderIndex = 0;
      for (let pIndex = 0; pIndex < opIndex; pIndex++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const playerLocal = remainder[pIndex]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const playerGlobal = playersByIndex[playerLocal]!;
        const ew = edgeWeightComputer(
          playerLocal,
          opponentLocal,
          playerRemainderIndex,
          remainderPairs,
        );
        mc.setEdgeWeight(playerGlobal, opponentGlobal, ew);
        playerRemainderIndex++;
      }
    }

    currentPhase = 'bracket-ordering';
    stableMatching = runBlossom();

    // -----------------------------------------------------------------------
    // Exchange selection (FIDE Article 4.3)
    // -----------------------------------------------------------------------

    let exchangeCount = 0;
    for (let pIndex = 0; pIndex < remainderPairs; pIndex++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const playerLocal = remainder[pIndex]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const playerGlobal = playersByIndex[playerLocal]!;
      const matchGlobal = stableMatching[playerGlobal] ?? -1;
      if (
        matchGlobal <= playerGlobal ||
        matchGlobal >= nextScoreGroupBeginVertex
      ) {
        exchangeCount++;
      }
    }

    if (exchangeCount > 0) {
      // --- S1 exchange: probe lower S1 players (bottom-up) ---
      let exchangesRemaining = exchangeCount;
      let playerRemainderIndex = remainderPairs;
      for (
        let pIndex = remainderPairs - 1;
        pIndex >= 0 && exchangesRemaining > 0;
        pIndex--
      ) {
        playerRemainderIndex--;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const playerLocal = remainder[pIndex]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const playerGlobal = playersByIndex[playerLocal]!;

        const isMatchedWithin =
          (stableMatching[playerGlobal] ?? -1) > playerGlobal &&
          (stableMatching[playerGlobal] ?? -1) < nextScoreGroupBeginVertex;

        if (isMatchedWithin) {
          for (let oIndex = pIndex + 1; oIndex < remainder.length; oIndex++) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentLocal = remainder[oIndex]!;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentGlobal = playersByIndex[opponentLocal]!;
            const ew = edgeWeightComputer(
              playerLocal,
              opponentLocal,
              playerRemainderIndex,
              remainderPairs,
            );
            if (!ew.isZero()) {
              ew.subtract(1);
              mc.setEdgeWeight(playerGlobal, opponentGlobal, ew);
            }
          }
          currentPhase = 'bracket-exchange-s1';
          stableMatching = runBlossom();
        }

        const exchange =
          (stableMatching[playerGlobal] ?? -1) <= playerGlobal ||
          (stableMatching[playerGlobal] ?? -1) >= nextScoreGroupBeginVertex;
        if (exchange) exchangesRemaining--;

        for (let oIndex = pIndex + 1; oIndex < remainder.length; oIndex++) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const opponentLocal = remainder[oIndex]!;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const opponentGlobal = playersByIndex[opponentLocal]!;
          if (exchange) {
            (baseEdgeWeights[opponentLocal] as (DynamicUint | undefined)[])[
              playerLocal
            ] = DynamicUint.from(0);
          }
          const ew = edgeWeightComputer(
            playerLocal,
            opponentLocal,
            playerRemainderIndex,
            remainderPairs,
          );
          mc.setEdgeWeight(playerGlobal, opponentGlobal, ew);
        }
      }

      // --- S2 exchange: probe higher S2 players (top-down) ---
      exchangesRemaining = exchangeCount;
      let remIndex = remainderPairs;
      for (
        let pIndex = remainderPairs;
        pIndex < remainder.length && exchangesRemaining > 1;
        pIndex++
      ) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const playerLocal = remainder[pIndex]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const playerGlobal = playersByIndex[playerLocal]!;

        const alreadyExchanged =
          (stableMatching[playerGlobal] ?? -1) > playerGlobal &&
          (stableMatching[playerGlobal] ?? -1) < nextScoreGroupBeginVertex;

        if (!alreadyExchanged) {
          for (let oIndex = pIndex + 1; oIndex < remainder.length; oIndex++) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentLocal = remainder[oIndex]!;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentGlobal = playersByIndex[opponentLocal]!;
            const ew = edgeWeightComputer(
              playerLocal,
              opponentLocal,
              remIndex,
              remainderPairs,
            );
            if (!ew.isZero()) {
              ew.add(1);
              mc.setEdgeWeight(playerGlobal, opponentGlobal, ew);
            }
          }
          currentPhase = 'bracket-exchange-s2';
          stableMatching = runBlossom();
        }

        const exchange =
          (stableMatching[playerGlobal] ?? -1) > playerGlobal &&
          (stableMatching[playerGlobal] ?? -1) < nextScoreGroupBeginVertex;

        if (exchange) {
          exchangesRemaining--;
          for (let oIndex = 0; oIndex < pIndex; oIndex++) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentLocal = remainder[oIndex]!;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentGlobal = playersByIndex[opponentLocal]!;
            (baseEdgeWeights[playerLocal] as (DynamicUint | undefined)[])[
              opponentLocal
            ] = DynamicUint.from(0);
            mc.setEdgeWeight(playerGlobal, opponentGlobal, DynamicUint.from(0));
          }
          for (
            let opIndex = nextScoreGroupBegin;
            opIndex < playersByIndex.length;
            opIndex++
          ) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentGlobal = playersByIndex[opIndex]!;
            (baseEdgeWeights[opIndex] as (DynamicUint | undefined)[])[
              playerLocal
            ] = DynamicUint.from(0);
            mc.setEdgeWeight(playerGlobal, opponentGlobal, DynamicUint.from(0));
          }
        }

        if (!alreadyExchanged) {
          for (let oIndex = pIndex + 1; oIndex < remainder.length; oIndex++) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentLocal = remainder[oIndex]!;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const opponentGlobal = playersByIndex[opponentLocal]!;
            const ew = edgeWeightComputer(
              playerLocal,
              opponentLocal,
              remIndex,
              remainderPairs,
            );
            mc.setEdgeWeight(playerGlobal, opponentGlobal, ew);
          }
        }
        remIndex++;
      }
    }

    // -----------------------------------------------------------------------
    // Remainder Phase A: finalize exchange decisions + reset ordering bits
    //
    // For each pair in the remainder, if the S1 player is NOT matched within
    // the bracket (exchanged to downfloater) or the S2 player IS matched
    // within the bracket (exchanged to S1), zero the base edge weight.
    // Then restore the matrix to the (possibly zeroed) base weights.
    // (Mirrors bbpPairings lines 1509-1543.)
    // -----------------------------------------------------------------------
    for (let pIndex = 0; pIndex < remainder.length; pIndex++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const playerLocal = remainder[pIndex]!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const playerGlobal = playersByIndex[playerLocal]!;

      for (let oIndex = pIndex + 1; oIndex < remainder.length; oIndex++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const opponentLocal = remainder[oIndex]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const opponentGlobal = playersByIndex[opponentLocal]!;

        const playerNotMatched =
          stableMatching[playerGlobal] === undefined ||
          (stableMatching[playerGlobal] ?? -1) <= playerGlobal ||
          (stableMatching[playerGlobal] ?? -1) >= nextScoreGroupBeginVertex;
        const opponentMatched =
          (stableMatching[opponentGlobal] ?? -1) > opponentGlobal &&
          (stableMatching[opponentGlobal] ?? -1) < nextScoreGroupBeginVertex;

        if (playerNotMatched || opponentMatched) {
          (baseEdgeWeights[opponentLocal] as (DynamicUint | undefined)[])[
            playerLocal
          ] = DynamicUint.from(0);
        }

        const base = (
          baseEdgeWeights[opponentLocal] as (DynamicUint | undefined)[]
        )[playerLocal];
        mc.setEdgeWeight(
          playerGlobal,
          opponentGlobal,
          base === undefined ? DynamicUint.from(0) : base.clone(),
        );
      }
    }

    // -----------------------------------------------------------------------
    // Remainder Phase B: per-player finalization with blossom re-runs
    //
    // For each S1 player that is matched within the bracket, boost edges
    // to S2 opponents (higher-ranked get larger addend), run blossom, and
    // finalizePair. (Mirrors bbpPairings lines 1545-1599.)
    // -----------------------------------------------------------------------
    currentPhase = 'bracket-remainder';

    for (const playerLocal of remainder) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const playerGlobal = playersByIndex[playerLocal]!;

      if (
        (stableMatching[playerGlobal] ?? -1) <= playerGlobal ||
        (stableMatching[playerGlobal] ?? -1) >= nextScoreGroupBeginVertex
      ) {
        continue;
      }

      let addend = 0;
      for (let oIndex = remainder.length - 1; oIndex >= 0; oIndex--) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const opponentLocal = remainder[oIndex]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const opponentGlobal = playersByIndex[opponentLocal]!;

        if (opponentLocal <= playerLocal || matched[opponentGlobal]) {
          continue;
        }

        const base = (
          baseEdgeWeights[opponentLocal] as (DynamicUint | undefined)[]
        )[playerLocal];
        if (base !== undefined && !base.isZero()) {
          const boosted = base.clone();
          boosted.add(addend);
          mc.setEdgeWeight(playerGlobal, opponentGlobal, boosted);
        }
        addend++;
      }

      stableMatching = runBlossom();

      const matchGlobal = stableMatching[playerGlobal] ?? -1;
      if (
        matchGlobal >= 0 &&
        matchGlobal !== playerGlobal &&
        !matched[playerGlobal] &&
        !matched[matchGlobal]
      ) {
        matched[playerGlobal] = true;
        matched[matchGlobal] = true;
        finalizePairMC(playerGlobal, matchGlobal, mc, np);
        matchedPairs.push([playerGlobal, matchGlobal]);
        if (trace) {
          trace({
            phase: currentPhase,
            playerA: pairedSorted[playerGlobal]?.id ?? '',
            playerB: pairedSorted[matchGlobal]?.id ?? '',
            system: 'dutch',
            type: 'pairing:pair-finalized',
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Build next bracket: carry unmatched players as downfloaters
    // -----------------------------------------------------------------------
    const newPlayersByIndex: number[] = [];
    let newScoreGroupBegin = 0;

    // Update isSingleDownfloaterByeAssignee for next bracket
    // (bbpPairings does this check)
    if (
      needsBye &&
      sgIterator <= scoreGroupArrays.length &&
      byeAssigneeScore >=
        (pairedSorted[scoreGroupArrays[sgIterator - 1]?.[0] ?? 0]?.score ?? -1)
    ) {
      // Preliminary: might be true
      let stillSingle = true;
      for (
        let playerLocal = 0;
        playerLocal < nextScoreGroupBegin;
        playerLocal++
      ) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const playerGlobal = playersByIndex[playerLocal]!;
        if (playerLocal < nextScoreGroupBegin && matched[playerGlobal]) {
          const matchG = stableMatching[playerGlobal] ?? -1;
          const nextGroupScore =
            sgIterator < scoreGroupArrays.length
              ? (pairedSorted[scoreGroupArrays[sgIterator]?.[0] ?? 0]?.score ??
                -1)
              : -1;
          if (
            matchG >= 0 &&
            (pairedSorted[matchG]?.score ?? -1) < nextGroupScore
          ) {
            stillSingle = false;
            break;
          }
        }
      }
      isSingleDownfloaterByeAssignee = stillSingle;
    } else {
      isSingleDownfloaterByeAssignee = false;
    }

    for (const [playerLocal, element] of playersByIndex.entries()) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const playerGlobal = element!;
      if (playerLocal < nextScoreGroupBegin && matched[playerGlobal]) {
        // Player was finalized — record if needed (already done in finalizePair)
        // noop here — matchedPairs already recorded
        void 0;
      } else {
        // Carry to next bracket
        newPlayersByIndex.push(playerGlobal);
        if (playerLocal < nextScoreGroupBegin) {
          newScoreGroupBegin++;
        }
      }
    }

    playersByIndex = newPlayersByIndex;
    scoreGroupBegin = newScoreGroupBegin;
    scoreGroupBeginVertex = nextScoreGroupBeginVertex;
  }

  // -------------------------------------------------------------------------
  // Phase 6: Fallback — pair any remaining unmatched players
  // -------------------------------------------------------------------------
  // After the bracket loop, playersByIndex may still contain unmatched players.
  // Try pairing them among themselves first. If that's not possible (incompatible),
  // fall back to a full global re-match of ALL originally paired players.
  if (playersByIndex.length >= 2) {
    const fallbackEdges: [number, number, DynamicUint][] = [];
    for (let ii = 0; ii < playersByIndex.length; ii++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const index = playersByIndex[ii]!;
      const hiPlayer = pairedSorted[index];
      if (hiPlayer === undefined) continue;
      for (let jj = 0; jj < ii; jj++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const index_ = playersByIndex[jj]!;
        const loPlayer = pairedSorted[index_];
        if (loPlayer === undefined) continue;
        const w = computeEdgeWeight(
          loPlayer,
          hiPlayer,
          true,
          false,
          byeAssigneeScore,
          playedRounds,
          expectedRounds,
          sgp,
          isSingleDownfloaterByeAssignee,
          unplayedGameRanks,
        );
        if (!w.isZero()) fallbackEdges.push([index_, index, w]);
      }
    }
    if (fallbackEdges.length > 0) {
      if (trace) {
        trace({
          phase: 'bracket-fallback',
          remainingCount: playersByIndex.length,
          type: 'dutch:fallback',
        });
      }
      if (trace) {
        trace({
          edgeCount: fallbackEdges.length,
          phase: 'bracket-fallback',
          system: 'dutch',
          type: 'pairing:blossom-invoked',
          vertexCount: playersByIndex.length,
        });
      }
      const fallbackMatch = maxWeightMatching(fallbackEdges, true, trace);
      if (trace) {
        const pairs: [string, string][] = [];
        let unmatchedCount = 0;
        for (const [k, element] of fallbackMatch.entries()) {
          const mk = element ?? -1;
          if (mk > k) {
            const aState = pairedSorted[k];
            const bState = pairedSorted[mk];
            if (aState && bState) pairs.push([aState.id, bState.id]);
          } else if (mk === -1 || mk === k) {
            unmatchedCount++;
          }
        }
        trace({
          pairs,
          phase: 'bracket-fallback',
          system: 'dutch',
          type: 'pairing:blossom-result',
          unmatchedCount,
        });
      }
      const seen = new Set<number>();
      for (const [k, element] of fallbackMatch.entries()) {
        const mk = element ?? -1;
        if (mk < 0 || mk === k || seen.has(k) || seen.has(mk)) continue;
        seen.add(k);
        seen.add(mk);
        if (k < mk) matchedPairs.push([k, mk]);
        else matchedPairs.push([mk, k]);
      }
    }
  }

  // If the bracket-by-bracket approach produced fewer pairs than expected,
  // fall back to a single global blossom as a safety net.
  const expectedPairCount = Math.floor(np / 2);
  if (matchedPairs.length < expectedPairCount) {
    matchedPairs.length = 0; // clear and restart with global blossom

    // Recompute score levels using the original single-pass approach
    const sgMapGlobal = scoreGroups(pairedSorted);
    const scorelevelsGlobal = [...sgMapGlobal.keys()].toSorted((a, b) => b - a);
    const scoreLevelGlobal = new Map<string, number>();
    for (const [lvl, sc] of scorelevelsGlobal.entries()) {
      for (const p of sgMapGlobal.get(sc) ?? []) {
        scoreLevelGlobal.set(p.id, lvl);
      }
    }

    const globalEdges: [number, number, DynamicUint][] = [];
    for (let index = 0; index < np; index++) {
      for (let index_ = 0; index_ < index; index_++) {
        const hi = pairedSorted[index_];
        const lo = pairedSorted[index];
        if (hi === undefined || lo === undefined) continue;
        const hiLevel = scoreLevelGlobal.get(hi.id) ?? 0;
        const loLevel = scoreLevelGlobal.get(lo.id) ?? 0;
        const lowerInCurrent = hiLevel === loLevel;
        const lowerInNext = loLevel === hiLevel + 1;
        const w = computeEdgeWeight(
          hi,
          lo,
          lowerInCurrent,
          lowerInNext,
          byeAssigneeScore,
          playedRounds,
          expectedRounds,
          sgp,
          isSingleDownfloaterByeAssignee,
          unplayedGameRanks,
        );
        if (!w.isZero()) globalEdges.push([index_, index, w]);
      }
    }

    if (trace) {
      trace({
        phase: 'global-fallback',
        remainingCount: np,
        type: 'dutch:fallback',
      });
    }
    if (trace) {
      trace({
        edgeCount: globalEdges.length,
        phase: 'global-fallback',
        system: 'dutch',
        type: 'pairing:blossom-invoked',
        vertexCount: np,
      });
    }
    const globalMatch = maxWeightMatching(globalEdges, true, trace);
    if (trace) {
      const pairs: [string, string][] = [];
      let unmatchedCount = 0;
      for (const [k, element] of globalMatch.entries()) {
        const mk = element ?? -1;
        if (mk > k) {
          const aState = pairedSorted[k];
          const bState = pairedSorted[mk];
          if (aState && bState) pairs.push([aState.id, bState.id]);
        } else if (mk === -1 || mk === k) {
          unmatchedCount++;
        }
      }
      trace({
        pairs,
        phase: 'global-fallback',
        system: 'dutch',
        type: 'pairing:blossom-result',
        unmatchedCount,
      });
    }
    const seenGlobal = new Set<number>();
    for (let k = 0; k < np; k++) {
      if (seenGlobal.has(k)) continue;
      const mk = globalMatch[k] ?? -1;
      if (mk < 0 || mk === k) continue;
      seenGlobal.add(k);
      seenGlobal.add(mk);
      if (k < mk) matchedPairs.push([k, mk]);
      else matchedPairs.push([mk, k]);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 7: Extract pairings from matchedPairs
  // -------------------------------------------------------------------------
  const result: [PlayerState, PlayerState][] = [];
  for (const [globalA, globalB] of matchedPairs) {
    const a = pairedSorted[globalA];
    const b = pairedSorted[globalB];
    if (a === undefined || b === undefined) continue;
    result.push(a.tpn < b.tpn ? [a, b] : [b, a]);
  }

  const pairings = result.map(([a, b]) =>
    allocateColor(a, b, DUTCH_COLOR_RULES, dutchRankCompare),
  );

  if (trace) {
    for (const p of pairings) {
      trace({
        black: p.black,
        rule: 'dutch-article-5.2',
        system: 'dutch',
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
