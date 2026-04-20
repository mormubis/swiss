/**
 * @internal
 * Shared utilities for all FIDE Swiss pairing systems.
 * Provides a precomputed PlayerState struct and related helper functions.
 */
import type { FloatKind, Game, Player } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type Color = 'black' | 'white';

type ColorRule = (
  hrp: PlayerState,
  opponent: PlayerState,
) => 'continue' | 'hrp-black' | 'hrp-white';

interface PlayerState {
  byeCount: number;
  colorDiff: number;
  colorHistory: ('black' | 'white' | undefined)[];
  floatHistory: FloatKind[];
  id: string;
  opponents: Set<string>;
  preferenceStrength: 'absolute' | 'mild' | 'none' | 'strong';
  preferredColor: 'black' | 'white' | undefined;
  score: number;
  tpn: number;
  unplayedRounds: number;
}

// ---------------------------------------------------------------------------
// New precomputed PlayerState API
// ---------------------------------------------------------------------------

/**
 * Builds all PlayerState objects from the player list and game history.
 * All per-player data is computed once and cached.
 */
function buildPlayerStates(players: Player[], games: Game[][]): PlayerState[] {
  const roundCount = games.length;

  // Precompute cumulative score table: cumulativeScore[roundIndex] maps
  // player id → score BEFORE that round.
  const cumulativeScore: Map<string, number>[] = [];
  const runningScoreMap = new Map<string, number>();

  for (const round of games) {
    cumulativeScore.push(new Map(runningScoreMap));
    for (const game of round) {
      // Skip byes (black === '')
      if (game.black === '') continue;
      runningScoreMap.set(
        game.white,
        (runningScoreMap.get(game.white) ?? 0) + game.result,
      );
      runningScoreMap.set(
        game.black,
        (runningScoreMap.get(game.black) ?? 0) + (1 - game.result),
      );
    }
  }

  return players.map((player, index) => {
    const id = player.id;

    let score = 0;
    const opponents = new Set<string>();
    const colorHistory: ('black' | 'white' | undefined)[] = [];
    let byeCount = 0;
    let unplayedRounds = 0;
    const floatHistory: FloatKind[] = [];

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
      const round = games[roundIndex] as Game[];
      const game = round.find((g) => g.white === id || g.black === id);

      if (game === undefined) {
        colorHistory.push(undefined);
        floatHistory.push(undefined);
        unplayedRounds++;
        continue;
      }

      // Bye sentinel: black === ''
      if (game.black === '') {
        byeCount++;
        colorHistory.push(undefined);
        floatHistory.push('down');
        continue;
      }

      // Real game
      const isWhite = game.white === id;

      // Forfeit — game was not actually played, no color recorded
      // (matches bbpPairings: gameWasPlayed = false for +/- results)
      const isForfeit =
        game.kind === 'forfeit-win' || game.kind === 'forfeit-loss';
      colorHistory.push(isForfeit ? undefined : isWhite ? 'white' : 'black');

      score += isWhite ? game.result : 1 - game.result;
      opponents.add(isWhite ? game.black : game.white);

      // Float status
      // Forfeit: bbpPairings treats unplayed games specially —
      // forfeit win (points > loss) = FLOAT_DOWN, otherwise FLOAT_NONE.
      if (isForfeit) {
        const wonForfeit =
          (isWhite && game.kind === 'forfeit-win') ||
          (!isWhite && game.kind === 'forfeit-loss');
        floatHistory.push(wonForfeit ? 'down' : undefined);
      } else {
        const opponentId = isWhite ? game.black : game.white;
        const scoresBeforeRound = cumulativeScore[roundIndex];
        const playerScoreBefore = scoresBeforeRound?.get(id) ?? 0;
        const opponentScoreBefore = scoresBeforeRound?.get(opponentId) ?? 0;

        if (playerScoreBefore > opponentScoreBefore) {
          floatHistory.push('down');
        } else if (playerScoreBefore < opponentScoreBefore) {
          floatHistory.push('up');
        } else {
          floatHistory.push(undefined);
        }
      }
    }

    // colorDiff: whites - blacks
    let whites = 0;
    let blacks = 0;
    for (const c of colorHistory) {
      if (c === 'white') whites++;
      else if (c === 'black') blacks++;
    }
    const colorDiff = whites - blacks;

    // preferenceStrength
    const nonUndefinedColors = colorHistory.filter(
      (c): c is 'black' | 'white' => c !== undefined,
    );
    const hasHistory = nonUndefinedColors.length > 0;
    const lastTwo = nonUndefinedColors.slice(-2);

    let preferenceStrength: PlayerState['preferenceStrength'];
    if (!hasHistory) {
      preferenceStrength = 'none';
    } else if (
      Math.abs(colorDiff) > 1 ||
      (lastTwo.length === 2 && lastTwo[0] === lastTwo[1])
    ) {
      preferenceStrength = 'absolute';
    } else if (Math.abs(colorDiff) === 1) {
      preferenceStrength = 'strong';
    } else {
      // colorDiff === 0, has history
      preferenceStrength = 'mild';
    }

    // preferredColor
    let preferredColor: 'black' | 'white' | undefined;
    if (!hasHistory) {
      preferredColor = undefined;
    } else if (colorDiff > 0) {
      // more whites → prefer black
      preferredColor = 'black';
    } else if (colorDiff < 0) {
      // more blacks → prefer white
      preferredColor = 'white';
    } else {
      // colorDiff === 0: prefer opposite of last color played
      const lastColor = nonUndefinedColors.at(-1);
      if (lastColor === 'white') {
        preferredColor = 'black';
      } else if (lastColor === 'black') {
        preferredColor = 'white';
      } else {
        preferredColor = undefined;
      }
    }

    return {
      byeCount,
      colorDiff,
      colorHistory,
      floatHistory,
      id,
      opponents,
      preferenceStrength,
      preferredColor,
      score,
      tpn: index + 1,
      unplayedRounds,
    };
  });
}

/**
 * Returns a Map with keys = scores sorted descending,
 * values = PlayerState arrays sorted by TPN ascending within each group.
 */
function scoreGroups(states: PlayerState[]): Map<number, PlayerState[]> {
  const groups = new Map<number, PlayerState[]>();
  for (const state of states) {
    const group = groups.get(state.score) ?? [];
    group.push(state);
    groups.set(state.score, group);
  }

  // Sort each group by TPN ascending
  // Return map with keys sorted descending; sort groups by TPN ascending
  return new Map(
    [...groups.entries()]
      .toSorted(([a], [b]) => b - a)
      .map(([k, v]) => [k, v.toSorted((a, b) => a.tpn - b.tpn)]),
  );
}

/**
 * Assigns the bye per FIDE basic rules.
 * Returns the selected player state, or undefined if player count is even.
 *
 * 1. If player count is even, return undefined.
 * 2. Filter to players with byeCount === 0 (eligible). If none, use all.
 * 3. Among eligible, find those with the lowest score.
 * 4. If tied, use the tiebreak comparator.
 */
function assignBye(
  states: PlayerState[],
  _games: Game[][],
  tiebreak: (a: PlayerState, b: PlayerState) => number,
): PlayerState | undefined {
  if (states.length % 2 === 0) {
    return undefined;
  }

  const eligible = states.filter((s) => s.byeCount === 0);
  const pool = eligible.length > 0 ? eligible : states;

  const minScore = Math.min(...pool.map((s) => s.score));
  const lowestScored = pool.filter((s) => s.score === minScore);

  if (lowestScored.length === 1) {
    return lowestScored[0];
  }

  return lowestScored.toSorted(tiebreak)[0];
}

/**
 * Color allocation engine.
 *
 * Determines the Higher-Ranked Player (HRP): higher score wins; if tied,
 * use rankCompare (negative return = first arg ranks higher).
 * Walks the rules array until one returns a decision.
 * Fallback: HRP gets white.
 */
function allocateColor(
  a: PlayerState,
  b: PlayerState,
  rules: ColorRule[],
  rankCompare: (x: PlayerState, y: PlayerState) => number,
): { black: string; white: string } {
  let hrp: PlayerState;
  let lrp: PlayerState;

  if (a.score > b.score) {
    hrp = a;
    lrp = b;
  } else if (b.score > a.score) {
    hrp = b;
    lrp = a;
  } else {
    const cmp = rankCompare(a, b);
    if (cmp <= 0) {
      hrp = a;
      lrp = b;
    } else {
      hrp = b;
      lrp = a;
    }
  }

  for (const rule of rules) {
    const decision = rule(hrp, lrp);
    if (decision === 'hrp-white') {
      return { black: lrp.id, white: hrp.id };
    }
    if (decision === 'hrp-black') {
      return { black: hrp.id, white: lrp.id };
    }
  }

  // Fallback: HRP gets white
  return { black: lrp.id, white: hrp.id };
}

// ---------------------------------------------------------------------------
// Legacy API — kept for backward compatibility with modules not yet migrated
// to the PlayerState-based API. These will be removed in tasks 5–11.
// ---------------------------------------------------------------------------

function gamesForPlayer(player: string, games: Game[][]): Game[] {
  return games.flat().filter((g) => g.white === player || g.black === player);
}

function score(player: string, games: Game[][]): number {
  let sum = 0;
  for (const g of gamesForPlayer(player, games)) {
    // Skip byes (black === '' or black === white sentinel)
    if (g.black === '' || g.black === g.white) continue;
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

/**
 * Returns score groups for a list of players (legacy, Player-based).
 * Used by lim.ts and lexicographic.ts.
 */
function playerScoreGroups(
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
 *
 * @deprecated Use assignBye(states, games, tiebreak) instead.
 */
function assignByeLegacy(
  ranked: Player[],
  games: Game[][],
): Player | undefined {
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
  allocateColor,
  assignBye,
  assignByeLegacy,
  assignColors,
  buildPlayerStates,
  byeScore,
  colorHistory,
  colorPreference,
  floatHistory,
  gamesForPlayer,
  hasFaced,
  isTopscorer,
  matchColorHistory,
  matchCount,
  playerScoreGroups,
  rankPlayers,
  score,
  scoreGroups,
  typeAColorPreference,
  unplayedRounds,
};

export type { Color, ColorRule, PlayerState };
