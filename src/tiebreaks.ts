import { gamesForPlayer, score } from './utilities.js';

import type { Game, Player } from './types.js';

function opponentIds(playerId: string, games: Game[]): string[] {
  return gamesForPlayer(playerId, games).map((g) =>
    g.whiteId === playerId ? g.blackId : g.whiteId,
  );
}

function buchholz(playerId: string, players: Player[], games: Game[]): number {
  let sum = 0;
  for (const id of opponentIds(playerId, games)) {
    sum += score(id, games);
  }
  return sum;
}

function buchholzCut(
  playerId: string,
  players: Player[],
  games: Game[],
): number {
  const scores = opponentIds(playerId, games)
    .map((id) => score(id, games))
    .toSorted((a, b) => a - b);
  return scores.slice(1).reduce((sum, s) => sum + s, 0);
}

function medianBuchholz(
  playerId: string,
  players: Player[],
  games: Game[],
): number {
  const scores = opponentIds(playerId, games)
    .map((id) => score(id, games))
    .toSorted((a, b) => a - b);
  return scores.slice(1, -1).reduce((sum, s) => sum + s, 0);
}

function sonnebornBerger(
  playerId: string,
  players: Player[],
  games: Game[],
): number {
  let sum = 0;
  for (const g of gamesForPlayer(playerId, games)) {
    const isWhite = g.whiteId === playerId;
    const opponentId = isWhite ? g.blackId : g.whiteId;
    const playerResult = isWhite ? g.result : 1 - g.result;
    const opponentScore = score(opponentId, games);
    sum += playerResult * opponentScore;
  }
  return sum;
}

function progressive(
  playerId: string,
  players: Player[],
  games: Game[],
): number {
  const byRound = gamesForPlayer(playerId, games).toSorted(
    (a, b) => a.round - b.round,
  );
  let running = 0;
  let total = 0;
  for (const g of byRound) {
    const isWhite = g.whiteId === playerId;
    running += isWhite ? g.result : 1 - g.result;
    total += running;
  }
  return total;
}

function directEncounter(
  playerId: string,
  players: Player[],
  games: Game[],
): number {
  const playerScore = score(playerId, games);
  const tiedPlayerIds = new Set(
    players
      .filter((p) => p.id !== playerId && score(p.id, games) === playerScore)
      .map((p) => p.id),
  );

  let sum = 0;
  for (const g of gamesForPlayer(playerId, games)) {
    const opponentId = g.whiteId === playerId ? g.blackId : g.whiteId;
    if (tiedPlayerIds.has(opponentId)) {
      const isWhite = g.whiteId === playerId;
      sum += isWhite ? g.result : 1 - g.result;
    }
  }
  return sum;
}

export {
  buchholz,
  buchholzCut,
  directEncounter,
  medianBuchholz,
  progressive,
  sonnebornBerger,
};
