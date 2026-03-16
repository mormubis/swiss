import { score } from './utilities.js';

import type { Game, Player, Standing, Tiebreak } from './types.js';

function standings(
  players: Player[],
  games: Game[],
  tiebreaks: Tiebreak[],
): Standing[] {
  const playerIds = new Set(players.map((p) => p.id));

  for (const g of games) {
    if (g.blackId !== '' && !playerIds.has(g.blackId)) {
      throw new RangeError(`Unknown player id in games: "${g.blackId}"`);
    }
    if (!playerIds.has(g.whiteId)) {
      throw new RangeError(`Unknown player id in games: "${g.whiteId}"`);
    }
  }

  const sorted = [...players].toSorted((a, b) => {
    const scoreDiff = score(b.id, games) - score(a.id, games);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    for (const tiebreak of tiebreaks) {
      const diff =
        tiebreak(b.id, players, games) - tiebreak(a.id, players, games);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  });

  return sorted.map((player, index) => ({
    playerId: player.id,
    rank: index + 1,
    score: score(player.id, games),
    tiebreaks: tiebreaks.map((tb) => tb(player.id, players, games)),
  }));
}

export { standings };
