import type { FloatKind, Game, Player } from './types.js';

type Color = 'black' | 'white';

function gamesForPlayer(player: string, games: Game[][]): Game[] {
  return games.flat().filter((g) => g.white === player || g.black === player);
}

function score(player: string, games: Game[][]): number {
  let sum = 0;
  for (const g of gamesForPlayer(player, games)) {
    sum += g.white === player ? g.result : 1 - g.result;
  }
  return sum;
}

function byeScore(player: string, games: Game[][]): number {
  return gamesForPlayer(player, games).filter((g) => g.black === g.white)
    .length;
}

function colorHistory(player: string, games: Game[][]): Color[] {
  const colors: Color[] = [];
  for (const round of games) {
    for (const g of round) {
      if (g.black === g.white) {
        continue;
      }
      if (g.white === player) {
        colors.push('white');
        break;
      }
      if (g.black === player) {
        colors.push('black');
        break;
      }
    }
  }
  return colors;
}

/**
 * Returns the color difference: positive means player has played more black
 * than white (prefers white next), negative means the opposite.
 */
function colorPreference(player: string, games: Game[][]): number {
  let diff = 0;
  for (const color of colorHistory(player, games)) {
    diff += color === 'black' ? 1 : -1;
  }
  return diff;
}

function scoreGroups(
  players: Player[],
  games: Game[][],
): Map<number, Player[]> {
  const groups = new Map<number, Player[]>();
  for (const player of players) {
    const s = score(player.id, games);
    const group = groups.get(s) ?? [];
    group.push(player);
    groups.set(s, group);
  }
  return groups;
}

/**
 * Returns the number of matches (unique rounds with a real opponent) played.
 * Bye rounds are not counted.
 */
function matchCount(player: string, games: Game[][]): number {
  let count = 0;
  for (const round of games) {
    for (const g of round) {
      if (g.black === g.white) {
        continue;
      }
      if (g.white === player || g.black === player) {
        count++;
        break;
      }
    }
  }
  return count;
}

/**
 * Returns an array of colors representing the match-level color history.
 * For each match (unique round with a real opponent), the color is determined
 * by the first game in that round. Bye rounds are excluded.
 */
function matchColorHistory(player: string, games: Game[][]): Color[] {
  const colors: Color[] = [];
  for (const round of games) {
    for (const g of round) {
      if (g.black === g.white) {
        continue;
      }
      if (g.white === player) {
        colors.push('white');
        break;
      }
      if (g.black === player) {
        colors.push('black');
        break;
      }
    }
  }
  return colors;
}

/**
 * Returns true if players a and b have faced each other in any previous game.
 */
function hasFaced(a: string, b: string, games: Game[][]): boolean {
  return games
    .flat()
    .some(
      (g) =>
        (g.white === a && g.black === b) || (g.white === b && g.black === a),
    );
}

/**
 * Assigns colors to a pairing based on each player's color history.
 * The player with a positive color preference (has played more black) gets white.
 */
function assignColors(
  a: Player,
  b: Player,
  games: Game[][],
): { black: string; white: string } {
  if (colorPreference(a.id, games) > 0) {
    return { black: b.id, white: a.id };
  }
  return { black: a.id, white: b.id };
}

/**
 * Returns players sorted by score descending, then rating descending.
 * This is the standard ranking used by all FIDE Swiss pairing systems.
 */
function rankPlayers(players: Player[], games: Game[][]): Player[] {
  return [...players].toSorted((a, b) => {
    const scoreDiff = score(b.id, games) - score(a.id, games);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
}

/**
 * Returns the player who should receive a bye this round, or undefined if
 * the player count is even. Prefers the lowest-ranked player who has not
 * already received a bye.
 */
function assignBye(ranked: Player[], games: Game[][]): Player | undefined {
  if (ranked.length % 2 === 0) {
    return undefined;
  }
  const eligible = ranked.filter((p) => byeScore(p.id, games) === 0);
  return eligible.at(-1) ?? ranked.at(-1);
}

/**
 * Type A color preference for Swiss Team (FIDE C.04.6 Article 1.7.1).
 * Returns 'white' if the team prefers White, 'black' if Black, undefined if no preference.
 */
function typeAColorPreference(
  player: string,
  games: Game[][],
): Color | undefined {
  const history = matchColorHistory(player, games);
  const whites = history.filter((c) => c === 'white').length;
  const blacks = history.filter((c) => c === 'black').length;
  const cd = whites - blacks; // color difference

  // Preference for White if CD < -1
  if (cd < -1) {
    return 'white';
  }
  // Preference for Black if CD > +1
  if (cd > 1) {
    return 'black';
  }

  const lastTwo = history.slice(-2);
  if (lastTwo.length === 2) {
    // CD is 0 or -1 and last two were Black → preference for White
    if ((cd === 0 || cd === -1) && lastTwo.every((c) => c === 'black')) {
      return 'white';
    }
    // CD is 0 or +1 and last two were White → preference for Black
    if ((cd === 0 || cd === 1) && lastTwo.every((c) => c === 'white')) {
      return 'black';
    }
  }

  return undefined;
}

/**
 * Returns true when playerScore > totalRounds / 2 (FIDE C.04.3 Article 1.8).
 */
function isTopscorer(playerScore: number, totalRounds: number): boolean {
  return playerScore > totalRounds / 2;
}

/**
 * Returns count of rounds where player had no game at all (not even a bye).
 * A bye (g.black === g.white) counts as played.
 */
function unplayedRounds(player: string, games: Game[][]): number {
  let count = 0;
  for (const round of games) {
    const hasGame = round.some((g) => g.white === player || g.black === player);
    if (!hasGame) {
      count++;
    }
  }
  return count;
}

/**
 * Returns per-round float status for a player.
 * 'down' = player floated down (higher score or received bye),
 * 'up' = player floated up (lower score),
 * undefined = equal scores or no game that round.
 */
function floatHistory(player: string, games: Game[][]): FloatKind[] {
  const result: FloatKind[] = [];
  for (const [roundIndex, round] of games.entries()) {
    const game = round.find((g) => g.white === player || g.black === player);

    if (game === undefined) {
      result.push(undefined);
      continue;
    }

    // Bye sentinel: g.black === g.white
    if (game.black === game.white) {
      result.push('down');
      continue;
    }

    const opponent = game.white === player ? game.black : game.white;
    const previousGames = games.slice(0, roundIndex);
    const playerScore = score(player, previousGames);
    const opponentScore = score(opponent, previousGames);

    if (playerScore > opponentScore) {
      result.push('down');
    } else if (playerScore < opponentScore) {
      result.push('up');
    } else {
      result.push(undefined);
    }
  }
  return result;
}

export {
  assignBye,
  assignColors,
  byeScore,
  colorHistory,
  colorPreference,
  floatHistory,
  gamesForPlayer,
  hasFaced,
  isTopscorer,
  matchColorHistory,
  matchCount,
  rankPlayers,
  score,
  scoreGroups,
  typeAColorPreference,
  unplayedRounds,
};

export type { Color };
