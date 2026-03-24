import { byeScore, hasFaced, matchCount, scoreGroups } from './utilities.js';

import type { Game, Pairing, Player } from './types.js';

type ColorAllocator = (
  a: Player,
  b: Player,
  players: Player[],
  games: Game[][],
) => { blackId: string; whiteId: string };

/**
 * Ranks players for lexicographic pairing (FIDE C.04.5 Article 1.2):
 * (1) score descending, (2) TPN ascending (original array index).
 */
function rankByScoreThenTPN(players: Player[], games: Game[][]): Player[] {
  const scoreMap = new Map<string, number>();
  for (const p of players) {
    let sum = 0;
    for (const g of games.flat()) {
      if (g.whiteId === p.id) {
        sum += g.result;
      } else if (g.blackId === p.id) {
        sum += 1 - g.result;
      }
    }
    scoreMap.set(p.id, sum);
  }

  return [...players].toSorted((a, b) => {
    const scoreDiff = (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    // TPN ascending: lower original index ranks higher
    return players.indexOf(a) - players.indexOf(b);
  });
}

/**
 * Assigns PAB (bye) for lexicographic pairing (FIDE C.04.5 Article 3.4).
 * Eligible candidates:
 *   1. Has not already received a bye or forfeit win (C2 — byeScore === 0)
 *   2. Lowest score
 *   3. Most matches played
 *   4. Largest TPN (highest original array index)
 * Returns undefined when player count is even.
 */
function assignLexicographicBye(
  players: Player[],
  ranked: Player[],
  games: Game[][],
): Player | undefined {
  if (ranked.length % 2 === 0) {
    return undefined;
  }

  // C2: exclude players who already received a bye
  const eligible = ranked.filter((p) => byeScore(p.id, games) === 0);
  const candidates = eligible.length > 0 ? eligible : ranked;

  // 1. Find lowest score among candidates
  const scoreMap = new Map<string, number>();
  for (const p of candidates) {
    let sum = 0;
    for (const g of games.flat()) {
      if (g.whiteId === p.id) {
        sum += g.result;
      } else if (g.blackId === p.id) {
        sum += 1 - g.result;
      }
    }
    scoreMap.set(p.id, sum);
  }

  const minScore = Math.min(...candidates.map((p) => scoreMap.get(p.id) ?? 0));
  const lowestScored = candidates.filter(
    (p) => (scoreMap.get(p.id) ?? 0) === minScore,
  );

  if (lowestScored.length === 1) {
    return lowestScored[0];
  }

  // 2. Most matches played among lowest-scored
  const matchCounts = new Map<string, number>();
  for (const p of lowestScored) {
    matchCounts.set(p.id, matchCount(p.id, games));
  }

  const maxMatches = Math.max(
    ...lowestScored.map((p) => matchCounts.get(p.id) ?? 0),
  );
  const mostMatches = lowestScored.filter(
    (p) => (matchCounts.get(p.id) ?? 0) === maxMatches,
  );

  if (mostMatches.length === 1) {
    return mostMatches[0];
  }

  // 3. Largest TPN (highest original array index)
  let best = mostMatches[0];
  for (const p of mostMatches) {
    if (best === undefined || players.indexOf(p) > players.indexOf(best)) {
      best = p;
    }
  }
  return best;
}

/**
 * Computes the FIDE identifier for a perfect matching (FIDE C.04.5 Art. 3.6).
 * A pair's "top member" is the player with the smaller TPN (original index).
 * The identifier: sort pairs by top-member TPN ascending, then concatenate
 * [all top TPNs, all bottom TPNs in corresponding pair order].
 */
function matchingIdentifier(
  matching: [Player, Player][],
  players: Player[],
): number[] {
  // Orient each pair: first = smaller TPN (top), second = larger TPN (bottom).
  const oriented = matching.map(([a, b]) => {
    const ia = players.indexOf(a);
    const ib = players.indexOf(b);
    return ia < ib
      ? ([a, b] as [Player, Player])
      : ([b, a] as [Player, Player]);
  });
  // Sort pairs by top-member TPN ascending.
  const sortedPairs = oriented.toSorted(
    ([a], [b]) => players.indexOf(a) - players.indexOf(b),
  );
  const tops = sortedPairs.map(([top]) => players.indexOf(top));
  const bottoms = sortedPairs.map(([, bot]) => players.indexOf(bot));
  return [...tops, ...bottoms];
}

/**
 * Generates all perfect matchings of a sorted array of players.
 * Each matching is an array of [player, player] pairs.
 */
function allPerfectMatchings(sorted: Player[]): [Player, Player][][] {
  if (sorted.length === 0) {
    return [[]];
  }
  const first = sorted[0];
  if (first === undefined) {
    return [[]];
  }
  const result: [Player, Player][][] = [];
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
  bracket: Player[],
  players: Player[],
  games: Game[][],
  allocateColors: ColorAllocator,
): Pairing[] {
  // Sort bracket by TPN ascending (original array index).
  const sorted = [...bracket].toSorted(
    (a, b) => players.indexOf(a) - players.indexOf(b),
  );

  // Generate all perfect matchings and sort by FIDE identifier.
  const matchings = allPerfectMatchings(sorted).toSorted((ma, mb) => {
    const ia = matchingIdentifier(ma, players);
    const ib = matchingIdentifier(mb, players);
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
    const valid = matching.every(([a, b]) => !hasFaced(a.id, b.id, games));
    if (valid) {
      return matching.map(([a, b]) => allocateColors(a, b, players, games));
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
  toBePaired: Player[],
  players: Player[],
  games: Game[][],
  allocateColors: ColorAllocator,
): Pairing[] {
  // Build score groups in descending score order.
  const groups = scoreGroups(toBePaired, games);
  const sortedScores = [...groups.keys()].toSorted((a, b) => b - a);

  const pairings: Pairing[] = [];
  // Track which players have been paired (to handle upfloaters).
  const remaining = new Map<number, Player[]>();
  for (const s of sortedScores) {
    const group = groups.get(s);
    if (group !== undefined) {
      // Within each group, sort by TPN ascending.
      remaining.set(
        s,
        [...group].toSorted((a, b) => players.indexOf(a) - players.indexOf(b)),
      );
    }
  }

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
              nextGroup.filter((p) => p.id !== upfloater.id),
            );
          }
        }
      }
    }

    const bracketPairings = pairBracket(
      bracket,
      players,
      games,
      allocateColors,
    );
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
