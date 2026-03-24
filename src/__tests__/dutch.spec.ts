import { describe, expect, it } from 'vitest';

import { pair } from '../dutch.js';

import type { Game, Player } from '../types.js';

const FOUR_PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

describe('dutch', () => {
  describe('round 1', () => {
    it('pairs top half vs bottom half within score group', () => {
      const result = pair(FOUR_PLAYERS, []);
      expect(result.pairings).toHaveLength(2);
      expect(result.byes).toHaveLength(0);
      // Top half: A, B; Bottom half: C, D
      // Each pairing must cross the boundary
      const topHalf = new Set(['A', 'B']);
      for (const pairing of result.pairings) {
        expect(
          topHalf.has(pairing.whiteId) !== topHalf.has(pairing.blackId),
        ).toBe(true);
      }
    });

    it('assigns bye to lowest-rated when odd count', () => {
      const result = pair(FOUR_PLAYERS.slice(0, 3), []);
      expect(result.byes).toHaveLength(1);
      expect(result.byes[0]?.playerId).toBe('C');
    });
  });

  describe('invariants', () => {
    it('never pairs the same two players twice', () => {
      const round1Games: Game[] = [
        { blackId: 'C', result: 1, whiteId: 'A' },
        { blackId: 'D', result: 1, whiteId: 'B' },
      ];
      const result = pair(FOUR_PLAYERS, [round1Games]);
      const pairs = result.pairings.map((p) =>
        [p.whiteId, p.blackId].toSorted().join('-'),
      );
      expect(pairs).not.toContain('A-C');
      expect(pairs).not.toContain('B-D');
    });

    it('produces a complete pairing (all players appear exactly once)', () => {
      const result = pair(FOUR_PLAYERS, []);
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      expect(new Set(allIds).size).toBe(4);
      expect(allIds).toHaveLength(4);
    });
  });

  describe('validation', () => {
    it('throws RangeError when fewer than 2 players', () => {
      expect(() => pair([FOUR_PLAYERS[0]!], [])).toThrow(RangeError);
    });
  });
});
