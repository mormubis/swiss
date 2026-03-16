import { byeScore, colorPreference, score } from './utilities.js';

import type { Game, PairingResult, Player } from './types.js';

function hasFaced(a: string, b: string, games: Game[]): boolean {
  return games.some(
    (g) =>
      (g.whiteId === a && g.blackId === b) ||
      (g.whiteId === b && g.blackId === a),
  );
}

function assignColors(
  a: Player,
  b: Player,
  games: Game[],
): { blackId: string; whiteId: string } {
  // positive colorPreference means a has played more black → prefers white
  if (colorPreference(a.id, games) > 0) {
    return { blackId: b.id, whiteId: a.id };
  }
  return { blackId: a.id, whiteId: b.id };
}

function dubov(
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

  // Sort: highest score first, then highest rating as tiebreaker
  const ranked = [...players].toSorted((a, b) => {
    const scoreDiff = score(b.id, games) - score(a.id, games);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  // Assign bye to lowest-ranked player who has not yet had one
  let byePlayer: Player | undefined;
  if (ranked.length % 2 !== 0) {
    const eligible = ranked.filter((p) => byeScore(p.id, games) === 0);
    byePlayer = eligible.at(-1) ?? ranked.at(-1);
  }

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

export { dubov };
