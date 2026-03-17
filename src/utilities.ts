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

export {
  BYE_SENTINEL,
  byeScore,
  colorHistory,
  colorPreference,
  gamesForPlayer,
  score,
  scoreGroups,
};

export type { Color };
