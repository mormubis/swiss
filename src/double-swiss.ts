import {
  byeScore,
  hasFaced,
  matchColorHistory,
  matchCount,
  scoreGroups,
} from './utilities.js';

import type { Game, Pairing, PairingResult, Player } from './types.js';

/**
 * Ranks players for Double-Swiss (FIDE C.04.5 Article 1.2):
 * (1) score descending, (2) TPN ascending (original array index).
 */
function rankDoubleSwissPlayers(players: Player[], games: Game[]): Player[] {
  const scoreMap = new Map<string, number>();
  for (const p of players) {
    let sum = 0;
    for (const g of games) {
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
 * Assigns PAB (bye) for Double-Swiss (FIDE C.04.5 Article 3.4).
 * Eligible candidates:
 *   1. Has not already received a bye or forfeit win (C2 — byeScore === 0)
 *   2. Lowest score
 *   3. Most matches played
 *   4. Largest TPN (highest original array index)
 * Returns undefined when player count is even.
 */
function assignDoubleSwissBye(
  players: Player[],
  ranked: Player[],
  games: Game[],
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
    for (const g of games) {
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
 * Allocates colors for a Double-Swiss pairing per FIDE C.04.5 Article 4.
 *
 * Determines the Higher-Ranked Player (HRP):
 *   - HRP = player with higher score.
 *   - If scores equal, HRP = player with smaller TPN (smaller index in `players`).
 *
 * Then applies rules 4.3.1 through 4.3.5 in descending priority.
 */
function allocateDoubleColors(
  a: Player,
  b: Player,
  players: Player[],
  games: Game[],
): { blackId: string; whiteId: string } {
  // Compute scores for a and b.
  let scoreA = 0;
  let scoreB = 0;
  for (const g of games) {
    if (g.whiteId === a.id) {
      scoreA += g.result;
    } else if (g.blackId === a.id) {
      scoreA += 1 - g.result;
    }
    if (g.whiteId === b.id) {
      scoreB += g.result;
    } else if (g.blackId === b.id) {
      scoreB += 1 - g.result;
    }
  }

  // Determine HRP: higher score wins; ties broken by smaller TPN (original array index).
  const tpnA = players.indexOf(a);
  const tpnB = players.indexOf(b);
  const hrpIsA = scoreA > scoreB || (scoreA === scoreB && tpnA < tpnB);
  const [hrp, opp] = hrpIsA ? [a, b] : [b, a];
  const hrpTpn = players.indexOf(hrp); // 0-based TPN

  const hrpHistory = matchColorHistory(hrp.id, games);
  const oppHistory = matchColorHistory(opp.id, games);

  // Helper: give HRP white.
  const hrpWhite = (): { blackId: string; whiteId: string } => ({
    blackId: opp.id,
    whiteId: hrp.id,
  });
  // Helper: give HRP black.
  const hrpBlack = (): { blackId: string; whiteId: string } => ({
    blackId: hrp.id,
    whiteId: opp.id,
  });

  // 4.3.1 — Both have zero match history.
  if (hrpHistory.length === 0 && oppHistory.length === 0) {
    // HRP has odd 1-based TPN → give HRP initial color (White).
    // HRP has even 1-based TPN → give HRP opposite (Black).
    const hrpTpn1Based = hrpTpn + 1;
    return hrpTpn1Based % 2 === 1 ? hrpWhite() : hrpBlack();
  }

  // 4.3.2 — Fewer Whites.
  const hrpWhites = hrpHistory.filter((c) => c === 'white').length;
  const oppWhites = oppHistory.filter((c) => c === 'white').length;
  if (hrpWhites !== oppWhites) {
    // Player with fewer whites gets White.
    return hrpWhites < oppWhites ? hrpWhite() : hrpBlack();
  }

  // 4.3.3 — Alternate from most recent divergence.
  // Walk back through both histories to find most recent round where colors differed.
  const minLength = Math.min(hrpHistory.length, oppHistory.length);
  for (let index = minLength - 1; index >= 0; index--) {
    const hrpColor = hrpHistory[index];
    const oppColor = oppHistory[index];
    if (
      hrpColor !== undefined &&
      oppColor !== undefined &&
      hrpColor !== oppColor
    ) {
      // Found divergence: alternate from that round.
      // If HRP had White in that round, HRP gets Black now (and vice versa).
      return hrpColor === 'white' ? hrpBlack() : hrpWhite();
    }
  }

  // 4.3.4 — Alternate HRP's color from most recent match.
  const hrpLast = hrpHistory.at(-1);
  if (hrpLast !== undefined) {
    return hrpLast === 'white' ? hrpBlack() : hrpWhite();
  }

  // 4.3.5 — Alternate opponent's color from most recent match.
  const oppLast = oppHistory.at(-1);
  if (oppLast !== undefined) {
    // Alternate opp's color: if opp had white → opp gets black (HRP gets white).
    return oppLast === 'white' ? hrpWhite() : hrpBlack();
  }

  // Fallback: HRP gets White.
  return hrpWhite();
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
  games: Game[],
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
      return matching.map(([a, b]) =>
        allocateDoubleColors(a, b, players, games),
      );
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
  games: Game[],
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

    const bracketPairings = pairBracket(bracket, players, games);
    pairings.push(...bracketPairings);
  }

  return pairings;
}

/**
 * Double-Swiss pairing (FIDE C.04.5).
 * Each round is a two-game match between the same opponents.
 * PAB (bye) awards 1.5 points.
 */
function doubleSwiss(
  players: Player[],
  games: Game[],
  round: number,
): PairingResult {
  if (round < 1) {
    throw new RangeError('round must be >= 1');
  }
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const ranked = rankDoubleSwissPlayers(players, games);
  const byePlayer = assignDoubleSwissBye(players, ranked, games);

  const toBePaired = ranked.filter((p) => p.id !== byePlayer?.id);
  const pairings = pairAllBrackets(toBePaired, players, games);

  return {
    byes: byePlayer === undefined ? [] : [{ playerId: byePlayer.id }],
    pairings,
  };
}

export { doubleSwiss };
