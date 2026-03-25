import { describe, expect, it } from 'vitest';

import { pair } from '../burstein.js';

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
      const result = pair(FOUR_PLAYERS, []);
      expect(result.pairings).toHaveLength(2);
      expect(result.byes).toHaveLength(0);
      const ids = result.pairings.map((p) =>
        [p.white, p.black].toSorted().join('-'),
      );
      expect(ids).toContain('A-D');
      expect(ids).toContain('B-C');
    });

    it('assigns a bye to the lowest-rated player when odd count', () => {
      const result = pair(FOUR_PLAYERS.slice(0, 3), []);
      expect(result.byes).toHaveLength(1);
      expect(result.byes[0]?.player).toBe('C');
    });
  });

  describe('invariants', () => {
    it('never pairs the same two players twice', () => {
      const round1Games: Game[] = [
        { black: 'D', result: 1, white: 'A' },
        { black: 'C', result: 1, white: 'B' },
      ];
      const result = pair(FOUR_PLAYERS, [round1Games]);
      const pairs = result.pairings.map((p) =>
        [p.white, p.black].toSorted().join('-'),
      );
      expect(pairs).not.toContain('A-D');
      expect(pairs).not.toContain('B-C');
    });

    it('does not give a bye to a player who already had one', () => {
      const threePlayers = FOUR_PLAYERS.slice(0, 3);
      const round1Games: Game[] = [
        { black: 'C', result: 1, white: 'C' },
        { black: 'B', result: 1, white: 'A' },
      ];
      const result = pair(threePlayers, [round1Games]);
      expect(result.byes[0]?.player).not.toBe('C');
    });
  });

  describe('validation', () => {
    it('throws RangeError when fewer than 2 players', () => {
      expect(() => pair([FOUR_PLAYERS[0]!], [])).toThrow(RangeError);
    });
  });
});
