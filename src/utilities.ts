import type { Game, Player } from './types.js';

type Color = 'black' | 'white';

/** Sentinel: empty string blackId signals a bye received by whiteId. */
const BYE_SENTINEL = '';

function gamesForPlayer(playerId: string, games: Game[]): Game[] {
  return games.filter((g) => g.whiteId === playerId || g.blackId === playerId);
}

function score(playerId: string, games: Game[]): number {
  let sum = 0;
  for (const g of gamesForPlayer(playerId, games)) {
    sum += g.whiteId === playerId ? g.result : 1 - g.result;
  }
  return sum;
}

function byeScore(playerId: string, games: Game[]): number {
  return gamesForPlayer(playerId, games).filter(
    (g) => g.whiteId === playerId && g.blackId === BYE_SENTINEL,
  ).length;
}

function colorHistory(playerId: string, games: Game[]): Color[] {
  return gamesForPlayer(playerId, games)
    .filter((g) => g.blackId !== BYE_SENTINEL)
    .toSorted((a, b) => a.round - b.round)
    .map((g) => (g.whiteId === playerId ? 'white' : 'black'));
}

/**
 * Returns the color difference: positive means player has played more black
 * than white (prefers white next), negative means the opposite.
 */
function colorPreference(playerId: string, games: Game[]): number {
  let diff = 0;
  for (const color of colorHistory(playerId, games)) {
    diff += color === 'black' ? 1 : -1;
  }
  return diff;
}

function scoreGroups(players: Player[], games: Game[]): Map<number, Player[]> {
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
 * Returns true if players a and b have faced each other in any previous game.
 */
function hasFaced(a: string, b: string, games: Game[]): boolean {
  return games.some(
    (g) =>
      (g.whiteId === a && g.blackId === b) ||
      (g.whiteId === b && g.blackId === a),
  );
}

/**
 * Assigns colors to a pairing based on each player's color history.
 * The player with a positive color preference (has played more black) gets white.
 */
function assignColors(
  a: Player,
  b: Player,
  games: Game[],
): { blackId: string; whiteId: string } {
  if (colorPreference(a.id, games) > 0) {
    return { blackId: b.id, whiteId: a.id };
  }
  return { blackId: a.id, whiteId: b.id };
}

/**
 * Returns players sorted by score descending, then rating descending.
 * This is the standard ranking used by all FIDE Swiss pairing systems.
 */
function rankPlayers(players: Player[], games: Game[]): Player[] {
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
function assignBye(ranked: Player[], games: Game[]): Player | undefined {
  if (ranked.length % 2 === 0) {
    return undefined;
  }
  const eligible = ranked.filter((p) => byeScore(p.id, games) === 0);
  return eligible.at(-1) ?? ranked.at(-1);
}

export {
  BYE_SENTINEL,
  assignBye,
  assignColors,
  byeScore,
  colorHistory,
  colorPreference,
  gamesForPlayer,
  hasFaced,
  rankPlayers,
  score,
  scoreGroups,
};

export type { Color };
