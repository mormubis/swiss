import { describe, expect, it } from 'vitest';

import { dubov } from '../dubov.js';

import type { Game, Player } from '../types.js';

const FOUR_PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

describe('dubov', () => {
  describe('round 1', () => {
    it('pairs adjacent ranks: 1 vs 2, 3 vs 4', () => {
      const result = dubov(FOUR_PLAYERS, [], 1);
      expect(result.pairings).toHaveLength(2);
      const ids = result.pairings.map((p) =>
        [p.whiteId, p.blackId].toSorted().join('-'),
      );
      expect(ids).toContain('A-B');
      expect(ids).toContain('C-D');
    });

    it('assigns a bye to the lowest-ranked odd player', () => {
      const result = dubov(FOUR_PLAYERS.slice(0, 3), [], 1);
      expect(result.byes).toHaveLength(1);
      expect(result.byes[0]?.playerId).toBe('C');
    });
  });

  describe('invariants', () => {
    it('never pairs the same two players twice', () => {
      const games: Game[] = [
        { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
        { blackId: 'D', result: 1, round: 1, whiteId: 'C' },
      ];
      const result = dubov(FOUR_PLAYERS, games, 2);
      const pairs = result.pairings.map((p) =>
        [p.whiteId, p.blackId].toSorted().join('-'),
      );
      expect(pairs).not.toContain('A-B');
      expect(pairs).not.toContain('C-D');
    });
  });

  describe('validation', () => {
    it('throws RangeError when round < 1', () => {
      expect(() => dubov(FOUR_PLAYERS, [], 0)).toThrow(RangeError);
    });

    it('throws RangeError when fewer than 2 players', () => {
      expect(() => dubov([FOUR_PLAYERS[0]!], [], 1)).toThrow(RangeError);
    });
  });
});
