import { describe, expect, it } from 'vitest';

import { standings } from '../standings.js';
import { buchholz, sonnebornBerger } from '../tiebreaks.js';

import type { Game, Player } from '../types.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];
const GAMES: Game[] = [
  { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
  { blackId: 'D', result: 0, round: 1, whiteId: 'C' },
  { blackId: 'D', result: 0.5, round: 2, whiteId: 'A' },
  { blackId: 'B', result: 0, round: 2, whiteId: 'C' },
  { blackId: 'C', result: 1, round: 3, whiteId: 'A' },
  { blackId: 'B', result: 1, round: 3, whiteId: 'D' },
];

describe('standings', () => {
  it('ranks players by score descending', () => {
    const result = standings(PLAYERS, GAMES, []);
    expect(result[0]?.score).toBe(2.5);
    expect(result[2]?.score).toBe(1);
    expect(result[3]?.score).toBe(0);
  });
  it('applies tiebreaks in order when scores are equal', () => {
    const result = standings(PLAYERS, GAMES, [buchholz]);
    expect(result[0]?.playerId).toBe('A');
    expect(result[1]?.playerId).toBe('D');
  });
  it('populates tiebreaks array on each standing entry', () => {
    const result = standings(PLAYERS, GAMES, [buchholz, sonnebornBerger]);
    expect(result[0]?.tiebreaks).toHaveLength(2);
  });
  it('assigns sequential ranks', () => {
    const result = standings(PLAYERS, GAMES, []);
    expect(result.map((s) => s.rank)).toEqual([1, 2, 3, 4]);
  });
  it('throws RangeError for unknown player id in games', () => {
    expect(() =>
      standings(
        PLAYERS,
        [{ blackId: 'UNKNOWN', result: 1, round: 1, whiteId: 'A' }],
        [],
      ),
    ).toThrow(RangeError);
  });
});
