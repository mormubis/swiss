import { scoreGroups } from './utilities.js';

import type { Pairing } from './types.js';
import type { PlayerState } from './utilities.js';

type ColorAllocator = (
  a: PlayerState,
  b: PlayerState,
) => { black: string; white: string };

/**
 * Ranks players for lexicographic pairing (FIDE C.04.5 Article 1.2):
 * (1) score descending, (2) TPN ascending (original array index).
 */
function rankByScoreThenTPN(states: PlayerState[]): PlayerState[] {
  return [...states].toSorted((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    // TPN ascending: lower TPN ranks higher
    return a.tpn - b.tpn;
  });
}

/**
 * Assigns PAB (bye) for lexicographic pairing (FIDE C.04.5 Article 3.4).
 * Eligible candidates:
 *   1. Has not already received a bye or forfeit win (C2 — byeCount === 0)
 *   2. Lowest score
 *   3. Most matches played (rounds - unplayedRounds - byeCount)
 *   4. Largest TPN (highest original array index)
 * Returns undefined when player count is even.
 */
function assignLexicographicBye(
  ranked: PlayerState[],
): PlayerState | undefined {
  if (ranked.length % 2 === 0) {
    return undefined;
  }

  // C2: exclude players who already received a bye
  const eligible = ranked.filter((s) => s.byeCount === 0);
  const candidates = eligible.length > 0 ? eligible : ranked;

  // 1. Find lowest score among candidates
  const minScore = Math.min(...candidates.map((s) => s.score));
  const lowestScored = candidates.filter((s) => s.score === minScore);

  if (lowestScored.length === 1) {
    return lowestScored[0];
  }

  // 2. Most matches played among lowest-scored
  // matches played = rounds with a real game = colorHistory length minus bye/unplayed
  const matchesPlayed = (s: PlayerState): number =>
    s.colorHistory.filter((c) => c !== undefined).length;

  const maxMatches = Math.max(...lowestScored.map((s) => matchesPlayed(s)));
  const mostMatches = lowestScored.filter(
    (s) => matchesPlayed(s) === maxMatches,
  );

  if (mostMatches.length === 1) {
    return mostMatches[0];
  }

  // 3. Largest TPN (highest original array index)
  return mostMatches.toSorted((a, b) => b.tpn - a.tpn)[0];
}

/**
 * Computes the FIDE identifier for a perfect matching (FIDE C.04.5 Art. 3.6).
 * A pair's "top member" is the player with the smaller TPN (original index).
 * The identifier: sort pairs by top-member TPN ascending, then concatenate
 * [all top TPNs, all bottom TPNs in corresponding pair order].
 */
function matchingIdentifier(matching: [PlayerState, PlayerState][]): number[] {
  // Orient each pair: first = smaller TPN (top), second = larger TPN (bottom).
  const oriented = matching.map(([a, b]) => {
    return a.tpn < b.tpn
      ? ([a, b] as [PlayerState, PlayerState])
      : ([b, a] as [PlayerState, PlayerState]);
  });
  // Sort pairs by top-member TPN ascending.
  const sortedPairs = oriented.toSorted(([a], [b]) => a.tpn - b.tpn);
  const tops = sortedPairs.map(([top]) => top.tpn);
  const bottoms = sortedPairs.map(([, bot]) => bot.tpn);
  return [...tops, ...bottoms];
}

/**
 * Generates all perfect matchings of a sorted array of player states.
 * Each matching is an array of [PlayerState, PlayerState] pairs.
 */
function allPerfectMatchings(
  sorted: PlayerState[],
): [PlayerState, PlayerState][][] {
  if (sorted.length === 0) {
    return [[]];
  }
  const first = sorted[0];
  if (first === undefined) {
    return [[]];
  }
  const result: [PlayerState, PlayerState][][] = [];
  for (let index = 1; index < sorted.length; index++) {
    const partner = sorted[index];
    if (partner === undefined) {
      continue;
    }
    const rest = sorted.filter((_, index_) => index_ !== 0 && index_ !== index);
    for (const subMatching of allPerfectMatchings(rest)) {
      result.push([[first, partner], ...subMatching]);
    }
  }
  return result;
}

/**
 * Pairs the bracket using lexicographic FIDE-identifier order (FIDE C.04.5
 * Article 3.6). Returns the first perfect matching satisfying C1 (no rematches).
 *
 * The identifier for a matching is: sort pairs by top-member TPN ascending,
 * then list all top TPNs followed by all bottom TPNs in corresponding pair
 * order. Top member = smaller TPN in the pair.
 */
function pairBracket(
  bracket: PlayerState[],
  allocateColors: ColorAllocator,
): Pairing[] {
  // Sort bracket by TPN ascending.
  const sorted = [...bracket].toSorted((a, b) => a.tpn - b.tpn);

  // Generate all perfect matchings and sort by FIDE identifier.
  const matchings = allPerfectMatchings(sorted).toSorted((ma, mb) => {
    const ia = matchingIdentifier(ma);
    const ib = matchingIdentifier(mb);
    for (let k = 0; k < Math.min(ia.length, ib.length); k++) {
      const diff = (ia[k] ?? 0) - (ib[k] ?? 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  });

  // Return the first matching satisfying C1 (no rematches).
  for (const matching of matchings) {
    const valid = matching.every(([a, b]) => !a.opponents.has(b.id));
    if (valid) {
      return matching.map(([a, b]) => allocateColors(a, b));
    }
  }

  return [];
}

/**
 * Pairs all score groups from highest to lowest, pulling upfloaters from the
 * next score group when the current group has an odd number of players.
 *
 * For v1, upfloaters are the highest-TPN players pulled from the next group
 * (minimum number needed to make the current bracket even).
 */
function pairAllBrackets(
  toBePaired: PlayerState[],
  allocateColors: ColorAllocator,
): Pairing[] {
  // Build score groups in descending score order.
  const groups = scoreGroups(toBePaired);
  const sortedScores = [...groups.keys()].toSorted((a, b) => b - a);

  const pairings: Pairing[] = [];
  // Track which players have been paired (to handle upfloaters).
  const remaining = new Map<number, PlayerState[]>(
    sortedScores.map((s) => [s, [...(groups.get(s) ?? [])]]),
  );

  for (let scoreIndex = 0; scoreIndex < sortedScores.length; scoreIndex++) {
    const currentScore = sortedScores[scoreIndex];
    if (currentScore === undefined) {
      continue;
    }

    let bracket = remaining.get(currentScore) ?? [];
    if (bracket.length === 0) {
      // Already consumed as upfloaters.
      continue;
    }

    // If the bracket has an odd number of players, pull upfloaters from the
    // next score group (minimum number = 1).
    if (bracket.length % 2 !== 0) {
      const nextScore = sortedScores[scoreIndex + 1];
      if (nextScore !== undefined) {
        const nextGroup = remaining.get(nextScore) ?? [];
        if (nextGroup.length > 0) {
          // Pull the highest-TPN player from the next group as upfloater
          // (last in TPN-ascending order).
          const upfloater = nextGroup.at(-1);
          if (upfloater !== undefined) {
            bracket = [...bracket, upfloater];
            remaining.set(
              nextScore,
              nextGroup.filter((s) => s.id !== upfloater.id),
            );
          }
        }
      }
    }

    const bracketPairings = pairBracket(bracket, allocateColors);
    pairings.push(...bracketPairings);
  }

  return pairings;
}

export type { ColorAllocator };
export {
  allPerfectMatchings,
  assignLexicographicBye,
  matchingIdentifier,
  pairAllBrackets,
  pairBracket,
  rankByScoreThenTPN,
};
