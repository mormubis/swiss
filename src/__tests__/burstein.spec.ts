import { describe, expect, it } from 'vitest';

import { burstein } from '../burstein.js';

import type { Game, Player } from '../types.js';

const FOUR_PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

describe('burstein', () => {
  describe('round 1', () => {
    it('pairs highest vs lowest, second vs third', () => {
      const result = burstein(FOUR_PLAYERS, [], 1);
      expect(result.pairings).toHaveLength(2);
      expect(result.byes).toHaveLength(0);
      const ids = result.pairings.map((p) =>
        [p.whiteId, p.blackId].toSorted().join('-'),
      );
      expect(ids).toContain('A-D');
      expect(ids).toContain('B-C');
    });

    it('assigns a bye to the lowest-rated player when odd count', () => {
      const result = burstein(FOUR_PLAYERS.slice(0, 3), [], 1);
      expect(result.byes).toHaveLength(1);
      expect(result.byes[0]?.playerId).toBe('C');
    });
  });

  describe('invariants', () => {
    it('never pairs the same two players twice', () => {
      const games: Game[] = [
        { blackId: 'D', result: 1, round: 1, whiteId: 'A' },
        { blackId: 'C', result: 1, round: 1, whiteId: 'B' },
      ];
      const result = burstein(FOUR_PLAYERS, games, 2);
      const pairs = result.pairings.map((p) =>
        [p.whiteId, p.blackId].toSorted().join('-'),
      );
      expect(pairs).not.toContain('A-D');
      expect(pairs).not.toContain('B-C');
    });

    it('does not give a bye to a player who already had one', () => {
      const threePlayers = FOUR_PLAYERS.slice(0, 3);
      const games: Game[] = [
        { blackId: '', result: 1, round: 1, whiteId: 'C' },
        { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
      ];
      const result = burstein(threePlayers, games, 2);
      expect(result.byes[0]?.playerId).not.toBe('C');
    });
  });

  describe('validation', () => {
    it('throws RangeError when round < 1', () => {
      expect(() => burstein(FOUR_PLAYERS, [], 0)).toThrow(RangeError);
    });

    it('throws RangeError when fewer than 2 players', () => {
      expect(() => burstein([FOUR_PLAYERS[0]!], [], 1)).toThrow(RangeError);
    });
  });
});
