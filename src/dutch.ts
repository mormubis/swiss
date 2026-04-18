/**
 * FIDE Dutch System pairing (C.04.3) — maximum-weight blossom matching.
 *
 * Uses the bbpPairings weight layout (C6–C21) with a single global blossom
 * pass. lowerInCurrent / lowerInNext are determined by score-group membership:
 *   lowerInCurrent — both players in the same score group
 *   lowerInNext    — lower player is in the next (lower) score group
 *
 * Algorithm outline
 * -----------------
 * 1. Build PlayerState for every player. Sort by score DESC, TPN ASC.
 * 2. Compute score-group parameters.
 * 3. Feasibility pass (odd count): determine byeAssigneeScore.
 * 4. Single global blossom with full bbpPairings weights.
 * 5. Allocate colours (Article 5.2). Assign bye.
 */

import { maxWeightMatching } from './blossom.js';
import { DynamicUint } from './dynamic-uint.js';
import {
  allocateColor,
  assignBye,
  buildPlayerStates,
  scoreGroups,
} from './utilities.js';

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
// Main pair function
// ---------------------------------------------------------------------------

function pair(players: Player[], games: Game[][]): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

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

    const m0 = maxWeightMatching(feasEdges, true);

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
  // Phase 3: Build score group membership for lowerInCurrent / lowerInNext
  // -------------------------------------------------------------------------
  const sgMap = scoreGroups(pairedSorted);
  const scoreLevels = [...sgMap.keys()].toSorted((a, b) => b - a); // desc

  // For each player, determine their score group level (0 = top)
  const scoreLevel = new Map<string, number>();
  for (const [lvl, sc] of scoreLevels.entries()) {
    for (const p of sgMap.get(sc) ?? []) {
      scoreLevel.set(p.id, lvl);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 4: Single global blossom with full bbpPairings weights
  // -------------------------------------------------------------------------
  const edges: [number, number, DynamicUint][] = [];
  for (let index = 0; index < np; index++) {
    for (let index_ = 0; index_ < index; index_++) {
      const hi = pairedSorted[index_];
      const lo = pairedSorted[index];
      if (hi === undefined || lo === undefined) continue;

      const hiLevel = scoreLevel.get(hi.id) ?? 0;
      const loLevel = scoreLevel.get(lo.id) ?? 0;

      // lowerInCurrent: both players in same score group
      const lowerInCurrent = hiLevel === loLevel;
      // lowerInNext: lower player is in the next score group (one level below hi)
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

      if (!w.isZero()) {
        edges.push([index_, index, w]);
      }
    }
  }

  const matching = maxWeightMatching(edges, true);

  // -------------------------------------------------------------------------
  // Extract pairings
  // -------------------------------------------------------------------------
  const result: [PlayerState, PlayerState][] = [];
  const seen = new Set<string>();

  for (let index = 0; index < np; index++) {
    const s = pairedSorted[index];
    if (s === undefined || seen.has(s.id)) continue;
    const mi = matching[index] ?? -1;
    if (mi < 0 || mi === index) continue;
    seen.add(s.id);
    const partner = pairedSorted[mi];
    if (partner === undefined) continue;
    seen.add(partner.id);
    result.push(s.tpn < partner.tpn ? [s, partner] : [partner, s]);
  }

  const pairings = result.map(([a, b]) =>
    allocateColor(a, b, DUTCH_COLOR_RULES, dutchRankCompare),
  );

  return {
    byes: byeId === undefined ? [] : [{ player: byeId }],
    pairings,
  };
}

export { pair };
