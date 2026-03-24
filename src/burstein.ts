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

  // Burstein: pair rank-1 vs rank-last, rank-2 vs rank-(last-1), etc.
  for (let hi = 0, lo = toBePaired.length - 1; hi < lo; hi++, lo--) {
    const top = toBePaired[hi];
    if (top === undefined || paired.has(top.id)) {
      continue;
    }

    // Find lowest unpaired opponent that hasn't faced top
    let bottom: Player | undefined;
    for (let offset = 0; lo - offset > hi; offset++) {
      const candidate = toBePaired[lo - offset];
      if (
        candidate !== undefined &&
        !paired.has(candidate.id) &&
        !hasFaced(top.id, candidate.id, games)
      ) {
        bottom = candidate;
        break;
      }
    }

    if (bottom === undefined) {
      continue;
    }

    pairings.push(assignColors(top, bottom, games));
    paired.add(top.id);
    paired.add(bottom.id);
  }

  return {
    byes: byePlayer === undefined ? [] : [{ playerId: byePlayer.id }],
    pairings,
  };
}

export { pair };
