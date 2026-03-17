import { blossom } from './blossom.js';
import { byeScore, colorPreference, score } from './utilities.js';

import type { Game, PairingResult, Player } from './types.js';

// Weight constants for the matching graph
const CROSS_HALF_WEIGHT = 10_000;
const COLOR_BONUS = 1;

function assignColors(
  a: Player,
  b: Player,
  games: Game[],
): { blackId: string; whiteId: string } {
  // positive colorPreference means player has played more black → prefers white
  if (colorPreference(a.id, games) > 0) {
    return { blackId: b.id, whiteId: a.id };
  }
  return { blackId: a.id, whiteId: b.id };
}

function dutch(players: Player[], games: Game[], round: number): PairingResult {
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
  const n = toBePaired.length;

  // Build per-score-group top/bottom half membership.
  // Within each score group, the top half is the higher-ranked players and
  // the bottom half is the lower-ranked. A cross-half pairing (S1 vs S2) is
  // strongly preferred per the Dutch system.
  const halfMembership = new Map<string, 'top' | 'bottom'>();

  // Group players by score (preserving ranked order within each group)
  const byScore = new Map<number, Player[]>();
  for (const p of toBePaired) {
    const s = score(p.id, games);
    const group = byScore.get(s) ?? [];
    group.push(p);
    byScore.set(s, group);
  }

  for (const groupPlayers of byScore.values()) {
    const half = Math.ceil(groupPlayers.length / 2);
    for (const [index, p] of groupPlayers.entries()) {
      halfMembership.set(p.id, index < half ? 'top' : 'bottom');
    }
  }

  // Build edge list for blossom matching
  const edges: [number, number, number][] = [];
  for (let index = 0; index < n; index++) {
    for (let index_ = index + 1; index_ < n; index_++) {
      const a = toBePaired[index];
      const b = toBePaired[index_];
      if (a === undefined || b === undefined) {
        continue;
      }

      // Forbidden: players who have already faced each other
      const alreadyFaced = games.some(
        (g) =>
          (g.whiteId === a.id && g.blackId === b.id) ||
          (g.whiteId === b.id && g.blackId === a.id),
      );
      if (alreadyFaced) {
        continue;
      }

      const halfA = halfMembership.get(a.id);
      const halfB = halfMembership.get(b.id);

      // Strongly prefer cross-half pairings (S1 vs S2); allow same-half as
      // fallback when no cross-half pairing is possible (e.g. rematch avoidance)
      const crossHalf = halfA !== halfB;
      let w = crossHalf ? CROSS_HALF_WEIGHT : 1;

      // Bonus for color balance: pairing players with opposite color preferences
      const prefA = colorPreference(a.id, games);
      const prefB = colorPreference(b.id, games);
      if ((prefA > 0 && prefB < 0) || (prefA < 0 && prefB > 0)) {
        w += COLOR_BONUS;
      }

      edges.push([index, index_, w]);
    }
  }

  const mate = blossom(n, edges);

  const pairings: PairingResult['pairings'] = [];
  const paired = new Set<number>();

  for (let index = 0; index < n; index++) {
    if (paired.has(index)) {
      continue;
    }
    const index_ = mate[index];
    if (index_ === undefined || index_ === -1) {
      continue;
    }
    paired.add(index);
    paired.add(index_);
    const playerA = toBePaired[index];
    const playerB = toBePaired[index_];
    if (playerA === undefined || playerB === undefined) {
      continue;
    }
    pairings.push(assignColors(playerA, playerB, games));
  }

  return {
    byes: byePlayer === undefined ? [] : [{ playerId: byePlayer.id }],
    pairings,
  };
}

export { dutch };
