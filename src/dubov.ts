import { assignBye, assignColors, hasFaced, rankPlayers } from './utilities.js';

import type { Game, PairingResult, Player } from './types.js';

function pair(players: Player[], games: Game[][]): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const ranked = rankPlayers(players, games);
  const byePlayer = assignBye(ranked, games);

  const toBePaired = ranked.filter((p) => p.id !== byePlayer?.id);
  const pairings: PairingResult['pairings'] = [];
  const paired = new Set<string>();

  // Dubov: pair rank-1 vs rank-2, rank-3 vs rank-4, etc.
  // If a pair has already faced each other, swap the second player with the
  // next available unpaired player.
  for (let index = 0; index < toBePaired.length - 1; index += 2) {
    const top = toBePaired[index];
    if (top === undefined || paired.has(top.id)) {
      continue;
    }

    // Find the nearest unpaired partner that hasn't faced top
    let partner: Player | undefined;
    for (let offset = 1; index + offset < toBePaired.length; offset++) {
      const candidate = toBePaired[index + offset];
      if (
        candidate !== undefined &&
        !paired.has(candidate.id) &&
        !hasFaced(top.id, candidate.id, games)
      ) {
        partner = candidate;
        break;
      }
    }

    if (partner === undefined) {
      continue;
    }

    pairings.push(assignColors(top, partner, games));
    paired.add(top.id);
    paired.add(partner.id);
  }

  return {
    byes: byePlayer === undefined ? [] : [{ playerId: byePlayer.id }],
    pairings,
  };
}

export { pair };
