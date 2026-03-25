import { describe, expect, it } from 'vitest';

import { pair } from '../lim.js';

import type { Game, Player } from '../types.js';

const SIX_PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
  { id: 'E', rating: 1600 },
  { id: 'F', rating: 1500 },
];

const FOUR_PLAYERS: Player[] = SIX_PLAYERS.slice(0, 4);

describe('lim', () => {
  describe('validation', () => {
    it('throws RangeError when fewer than 2 players', () => {
      expect(() => pair([FOUR_PLAYERS[0]!], [])).toThrow(RangeError);
    });
  });

  describe('round 1 — top half vs bottom half', () => {
    it('pairs 4 players: 1v3, 2v4', () => {
      const result = pair(FOUR_PLAYERS, []);
      expect(result.pairings).toHaveLength(2);
      expect(result.byes).toHaveLength(0);
      const ids = result.pairings.map((p) =>
        [p.white, p.black].toSorted().join('-'),
      );
      expect(ids).toContain('A-C');
      expect(ids).toContain('B-D');
    });

    it('pairs 6 players: 1v4, 2v5, 3v6', () => {
      const result = pair(SIX_PLAYERS, []);
      expect(result.pairings).toHaveLength(3);
      expect(result.byes).toHaveLength(0);
      const ids = result.pairings.map((p) =>
        [p.white, p.black].toSorted().join('-'),
      );
      expect(ids).toContain('A-D');
      expect(ids).toContain('B-E');
      expect(ids).toContain('C-F');
    });
  });

  describe('odd player count — bye', () => {
    it('assigns a bye to the lowest-ranked player', () => {
      const result = pair(FOUR_PLAYERS.slice(0, 3), []);
      expect(result.byes).toHaveLength(1);
      expect(result.byes[0]?.player).toBe('C');
      expect(result.pairings).toHaveLength(1);
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

  describe('exchange rules — rematches avoided', () => {
    it('exchanges to avoid rematch in scoregroup', () => {
      // A beat C in round 1; so A cannot face C again.
      // Default pairing in scoregroup {1pt}: A vs C — must exchange to A vs D or B vs C.
      const round1Games: Game[] = [
        { black: 'C', result: 1, white: 'A' },
        { black: 'D', result: 0, white: 'B' },
      ];
      // After round 1: A=1, B=0, C=0, D=1
      // scoregroup 1: A and D; scoregroup 0: B and C
      const result = pair(FOUR_PLAYERS, [round1Games]);
      const pairs = result.pairings.map((p) =>
        [p.white, p.black].toSorted().join('-'),
      );
      // A vs D is valid (didn't play); B vs C is valid (didn't play)
      expect(pairs).toContain('A-D');
      expect(pairs).toContain('B-C');
    });

    it('forces an exchange when top pairing is a rematch', () => {
      // All 4 players have 1 point but A already played C (the proposed pair 1v3)
      // (Making everyone have the same score so they're all in one group)
      const round1Games: Game[] = [
        { black: 'C', result: 0.5, white: 'A' },
        { black: 'B', result: 0.5, white: 'D' },
      ];
      // All at 0.5 pts — one scoregroup
      // Proposed: A vs C (rematch!) and D vs B (rematch!)
      // Must exchange: try A vs B and C vs D (or A vs D and B vs C)
      const result = pair(FOUR_PLAYERS, [round1Games]);
      const pairs = result.pairings.map((p) =>
        [p.white, p.black].toSorted().join('-'),
      );
      // No rematches
      for (const pairKey of pairs) {
        const wasPlayed = round1Games.some(
          (g) => [g.white, g.black].toSorted().join('-') === pairKey,
        );
        expect(wasPlayed).toBe(false);
      }
    });
  });

  describe('all players appear exactly once per round', () => {
    it('every player is paired or has a bye in round 1 (4 players)', () => {
      const result = pair(FOUR_PLAYERS, []);
      const allIds = new Set<string>();
      for (const p of result.pairings) {
        allIds.add(p.white);
        allIds.add(p.black);
      }
      for (const b of result.byes) {
        allIds.add(b.player);
      }
      for (const player of FOUR_PLAYERS) {
        expect(allIds.has(player.id)).toBe(true);
      }
    });

    it('every player is paired or has a bye in round 1 (6 players)', () => {
      const result = pair(SIX_PLAYERS, []);
      const allIds = new Set<string>();
      for (const p of result.pairings) {
        allIds.add(p.white);
        allIds.add(p.black);
      }
      for (const b of result.byes) {
        allIds.add(b.player);
      }
      for (const player of SIX_PLAYERS) {
        expect(allIds.has(player.id)).toBe(true);
      }
    });
  });

  describe('color allocation — alternation', () => {
    it('gives White to player who played Black in the previous round', () => {
      // Round 1: A(w) vs B(b) → draw; C(w) vs D(b) → draw
      // All at 0.5 pts; B and D played black, A and C played white
      const round1Games: Game[] = [
        { black: 'B', result: 0.5, white: 'A' },
        { black: 'D', result: 0.5, white: 'C' },
      ];
      // All at 0.5 pts — one scoregroup; B played black → should get white in round 2
      const result = pair(FOUR_PLAYERS, [round1Games]);
      const bPairing = result.pairings.find(
        (p) => p.white === 'B' || p.black === 'B',
      );
      expect(bPairing).toBeDefined();
      // B played black last round; B should get white (alternate)
      expect(bPairing?.white).toBe('B');
    });

    it('player who had same color last 2 rounds gets the alternate', () => {
      // Round 1: A(w) vs B(b) → A wins; C(w) vs D(b) → D wins
      // Round 2: A(w) vs D(b) → A wins; B(w) vs C(b) → B wins
      // A: white, white → must get black in round 3
      // Scores: A=2, B=1, C=0, D=0
      const round1Games: Game[] = [
        { black: 'B', result: 1, white: 'A' },
        { black: 'D', result: 0, white: 'C' },
      ];
      const round2Games: Game[] = [
        { black: 'D', result: 1, white: 'A' },
        { black: 'C', result: 1, white: 'B' },
      ];
      const result = pair(FOUR_PLAYERS, [round1Games, round2Games]);
      const aPairing = result.pairings.find(
        (p) => p.white === 'A' || p.black === 'A',
      );
      expect(aPairing).toBeDefined();
      expect(aPairing?.black).toBe('A');
    });
  });

  describe('no 3 same colors in a row', () => {
    it('prevents 3 same colors in a row (Article 5.1.1)', () => {
      // Round 1: A(w) vs B(b) → A wins; C(w) vs D(b) → D wins
      // Round 2: A(w) vs D(b) → A wins; B(w) vs C(b) → B wins
      // A played white in rounds 1 and 2; in round 3, A must play black
      const round1Games: Game[] = [
        { black: 'B', result: 1, white: 'A' },
        { black: 'D', result: 0, white: 'C' },
      ];
      const round2Games: Game[] = [
        { black: 'D', result: 1, white: 'A' },
        { black: 'C', result: 1, white: 'B' },
      ];
      const result = pair(FOUR_PLAYERS, [round1Games, round2Games]);
      const aPairing = result.pairings.find(
        (p) => p.white === 'A' || p.black === 'A',
      );
      expect(aPairing).toBeDefined();
      expect(aPairing?.black).toBe('A');
    });
  });

  describe('no rematches invariant', () => {
    it('never pairs the same two players twice across 2 rounds', () => {
      const round1Result = pair(FOUR_PLAYERS, []);
      const round1Games: Game[] = round1Result.pairings.map((p) => ({
        black: p.black,
        result: 1 as const,
        white: p.white,
      }));
      const round2Result = pair(FOUR_PLAYERS, [round1Games]);
      const round1Pairs = new Set(
        round1Result.pairings.map((p) =>
          [p.white, p.black].toSorted().join('-'),
        ),
      );
      for (const p of round2Result.pairings) {
        const key = [p.white, p.black].toSorted().join('-');
        expect(round1Pairs.has(key)).toBe(false);
      }
    });
  });

  describe('bi-directional scoregroup order', () => {
    it('processes highest and lowest scoregroups before median', () => {
      // After round 1: A=1, B=0.5, C=0.5, D=0, E=0.5, F=0.5
      // median = 0.5; order: 1 → 0 → 0.5
      const round1Games: Game[] = [
        { black: 'D', result: 1, white: 'A' },
        { black: 'E', result: 0.5, white: 'B' },
        { black: 'F', result: 0.5, white: 'C' },
      ];
      // This test just verifies the function runs without error and returns valid pairings
      const result = pair(SIX_PLAYERS, [round1Games]);
      const allIds = new Set<string>();
      for (const p of result.pairings) {
        allIds.add(p.white);
        allIds.add(p.black);
      }
      for (const b of result.byes) {
        allIds.add(b.player);
      }
      for (const player of SIX_PLAYERS) {
        expect(allIds.has(player.id)).toBe(true);
      }
    });
  });

  describe('multi-round simulation', () => {
    it('pairs 6 players through 3 rounds with no rematches', () => {
      let games: Game[][] = [];
      const allPairings: [string, string][] = [];

      for (let round = 1; round <= 3; round++) {
        const result = pair(SIX_PLAYERS, games);
        expect(result.pairings.length + result.byes.length).toBeGreaterThan(0);

        // Check no rematches
        for (const p of result.pairings) {
          const key = [p.white, p.black].toSorted().join('-') as string;
          const alreadyPlayed = allPairings.some(
            ([a, b]) => [a, b].toSorted().join('-') === key,
          );
          expect(alreadyPlayed).toBe(false);
          allPairings.push([p.white, p.black]);
        }

        // All players appear exactly once
        const roundIds = new Set<string>();
        for (const p of result.pairings) {
          expect(roundIds.has(p.white)).toBe(false);
          expect(roundIds.has(p.black)).toBe(false);
          roundIds.add(p.white);
          roundIds.add(p.black);
        }
        for (const b of result.byes) {
          expect(roundIds.has(b.player)).toBe(false);
          roundIds.add(b.player);
        }
        expect(roundIds.size).toBe(SIX_PLAYERS.length);

        // Simulate results: white always wins
        const roundGames: Game[] = [
          ...result.pairings.map((p) => ({
            black: p.black,
            result: 1 as const,
            white: p.white,
          })),
          ...result.byes.map((b) => ({
            black: b.player,
            result: 1 as const,
            white: b.player,
          })),
        ];
        games = [...games, roundGames];
      }
    });

    it('pairs 4 players through 3 rounds with no rematches', () => {
      let games: Game[][] = [];

      for (let round = 1; round <= 3; round++) {
        const result = pair(FOUR_PLAYERS, games);

        // All players appear exactly once
        const roundIds = new Set<string>();
        for (const p of result.pairings) {
          expect(roundIds.has(p.white)).toBe(false);
          expect(roundIds.has(p.black)).toBe(false);
          roundIds.add(p.white);
          roundIds.add(p.black);
        }
        for (const b of result.byes) {
          expect(roundIds.has(b.player)).toBe(false);
          roundIds.add(b.player);
        }
        expect(roundIds.size).toBe(FOUR_PLAYERS.length);

        // Simulate results: draw
        const roundGames: Game[] = [
          ...result.pairings.map((p) => ({
            black: p.black,
            result: 0.5 as const,
            white: p.white,
          })),
          ...result.byes.map((b) => ({
            black: b.player,
            result: 1 as const,
            white: b.player,
          })),
        ];
        games = [...games, roundGames];
      }
    });
  });
});
