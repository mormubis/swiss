import { describe, expect, it } from 'vitest';

import { pair } from '../swiss-team.js';

import type { Game, Player } from '../types.js';

/** Returns true if the given pairings contain a specific pair (order-insensitive). */
function hasPair(
  pairings: ReturnType<typeof pair>['pairings'],
  a: string,
  b: string,
): boolean {
  return pairings.some(
    (p) => (p.white === a && p.black === b) || (p.white === b && p.black === a),
  );
}

const FOUR_TEAMS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

const THREE_TEAMS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
];

describe('swissTeam', () => {
  describe('validation', () => {
    it('throws RangeError when fewer than 2 teams', () => {
      expect(() => pair([FOUR_TEAMS[0]!], [])).toThrow(RangeError);
    });
  });

  describe('even team count', () => {
    it('produces no byes when team count is even', () => {
      const result = pair(FOUR_TEAMS, []);
      expect(result.byes).toHaveLength(0);
    });

    it('produces correct number of pairings for 4 teams', () => {
      const result = pair(FOUR_TEAMS, []);
      expect(result.pairings).toHaveLength(2);
    });

    it('each team appears exactly once across all pairings', () => {
      const result = pair(FOUR_TEAMS, []);
      const allIds = result.pairings.flatMap((p) => [p.white, p.black]);
      expect(new Set(allIds).size).toBe(4);
      expect(allIds).toHaveLength(4);
    });
  });

  describe('odd team count (bye)', () => {
    it('assigns a bye when team count is odd', () => {
      const result = pair(THREE_TEAMS, []);
      expect(result.byes).toHaveLength(1);
    });

    it('assigns bye to team with largest TPN when all score is tied', () => {
      const result = pair(THREE_TEAMS, []);
      expect(result.byes[0]?.player).toBe('C');
    });
  });

  describe('PAB (bye) assignment', () => {
    it('prefers lowest-score team for bye', () => {
      const fiveTeams: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
      ];
      // A, B, C, D all scored 1 from draws; E has score 0
      const round1Games: Game[] = [
        { black: 'B', result: 0.5, white: 'A' },
        { black: 'D', result: 0.5, white: 'C' },
      ];
      const result = pair(fiveTeams, [round1Games]);
      expect(result.byes[0]?.player).toBe('E');
    });

    it('prefers team with most matches played when scores tie (lowest score)', () => {
      // B=0 (1 match), E=0 (0 matches) → B gets bye
      const fiveTeams: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
      ];
      const round1Games: Game[] = [
        { black: 'B', result: 1, white: 'A' },
        { black: 'D', result: 0.5, white: 'C' },
      ];
      const result = pair(fiveTeams, [round1Games]);
      expect(result.byes[0]?.player).toBe('B');
    });

    it('prefers largest TPN among tied lowest-score same-matches teams', () => {
      // 3 teams all score 0, no games. C has largest TPN → C gets bye
      const result = pair(THREE_TEAMS, []);
      expect(result.byes[0]?.player).toBe('C');
    });

    it('does not assign bye to team that already received one (C2 rule)', () => {
      const round1Games: Game[] = [{ black: '', result: 1, white: 'C' }];
      const result = pair(THREE_TEAMS, [round1Games]);
      expect(result.byes[0]?.player).not.toBe('C');
    });
  });

  describe('color allocation — 4.3.1 (no history, TPN-based)', () => {
    it('round 1: first-team with odd 1-based TPN gets White', () => {
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const result = pair(players, []);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.white).toBe('A');
      expect(pairing!.black).toBe('B');
    });

    it('round 1: first-team with even 1-based TPN gets Black', () => {
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const round1Games: Game[] = [
        // B received a bye in round 1 — gives score but no match color history
        { black: '', result: 1, white: 'B' },
      ];
      const result = pair(players, [round1Games]);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      // B is first-team with even 1-based TPN (2) → B gets Black → A gets White
      expect(pairing!.white).toBe('A');
      expect(pairing!.black).toBe('B');
    });
  });

  describe('color allocation — 4.3.2 (one team has Type A preference)', () => {
    it('grants preference when only one team has Type A preference', () => {
      // A had 3 blacks (CD = -3) → Type A preference for White; B has no games
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const games: Game[][] = [
        [{ black: 'A', result: 0.5, white: 'X' }],
        [{ black: 'A', result: 0.5, white: 'X' }],
        [{ black: 'A', result: 0.5, white: 'X' }],
      ];
      const result = pair(players, games);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.white).toBe('A');
    });

    it('grants opposing preference when both have Type A preference for opposite colors', () => {
      // A had 3 blacks → wants White; B had 3 whites → wants Black
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const games: Game[][] = [
        [
          { black: 'A', result: 0.5, white: 'X' },
          { black: 'X', result: 0.5, white: 'B' },
        ],
        [
          { black: 'A', result: 0.5, white: 'X' },
          { black: 'X', result: 0.5, white: 'B' },
        ],
        [
          { black: 'A', result: 0.5, white: 'X' },
          { black: 'X', result: 0.5, white: 'B' },
        ],
      ];
      const result = pair(players, games);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.white).toBe('A');
      expect(pairing!.black).toBe('B');
    });
  });

  describe('color allocation — 4.3.5 (lower CD gets White)', () => {
    it('team with lower color difference gets White', () => {
      // A: CD=0, B: CD=+1 → A has lower CD → A gets White
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      // A: white r1, black r2 → CD=0, last two=[white,black]
      // B: white r1, white r2, black r3 → CD=1, last two=[white,black]
      const games: Game[][] = [
        [
          { black: 'X', result: 0.5, white: 'A' },
          { black: 'X', result: 0.5, white: 'B' },
        ],
        [
          { black: 'A', result: 0.5, white: 'X' },
          { black: 'X', result: 0.5, white: 'B' },
        ],
        [{ black: 'B', result: 0.5, white: 'X' }],
      ];
      const result = pair(players, games);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.white).toBe('A');
    });
  });

  describe('color allocation — 4.3.8 (alternate first-team color)', () => {
    it('first-team alternates from last round when other rules do not apply', () => {
      // A matchColorHistory: [white, black] → CD=0, last two=[white,black] → no pref
      // B matchColorHistory: [white, black] → same; no divergence; A last=black → A gets White
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
      ];
      const round1Games: Game[] = [
        // Round 1: A(white) vs C, B(white) vs D
        { black: 'C', result: 0.5, white: 'A' },
        { black: 'D', result: 0.5, white: 'B' },
      ];
      const round2Games: Game[] = [
        // Round 2: A(black) vs D, B(black) vs C
        { black: 'A', result: 0.5, white: 'D' },
        { black: 'B', result: 0.5, white: 'C' },
      ];
      // Round 3: A hasn't faced B → can be paired
      // 4.3.8: alternate first-team(A) from last round: last=black → A gets White
      const result = pair(players, [round1Games, round2Games]);
      const pairing = result.pairings.find(
        (p) =>
          (p.white === 'A' && p.black === 'B') ||
          (p.white === 'B' && p.black === 'A'),
      );
      expect(pairing).toBeDefined();
      expect(pairing!.white).toBe('A');
    });
  });

  describe('no rematches invariant', () => {
    it('never pairs the same two teams twice across rounds (4 teams, 2 rounds)', () => {
      const result1 = pair(FOUR_TEAMS, []);
      const round1Games: Game[] = result1.pairings.map((p) => ({
        black: p.black,
        result: 0.5 as const,
        white: p.white,
      }));
      const result2 = pair(FOUR_TEAMS, [round1Games]);
      for (const p2 of result2.pairings) {
        const isRematch = result1.pairings.some(
          (p1) =>
            (p1.white === p2.white && p1.black === p2.black) ||
            (p1.white === p2.black && p1.black === p2.white),
        );
        expect(isRematch).toBe(false);
      }
    });
  });

  describe('multi-round simulation', () => {
    it('can pair 3 rounds of a 6-team tournament with no rematches', () => {
      const players: Player[] = [
        { id: 'A', rating: 2100 },
        { id: 'B', rating: 2000 },
        { id: 'C', rating: 1900 },
        { id: 'D', rating: 1800 },
        { id: 'E', rating: 1700 },
        { id: 'F', rating: 1600 },
      ];
      let games: Game[][] = [];

      for (let round = 1; round <= 3; round++) {
        const result = pair(players, games);
        expect(result.pairings).toHaveLength(3);
        expect(result.byes).toHaveLength(0);

        // Record games (all draws for simplicity)
        const roundGames: Game[] = result.pairings.map((p) => ({
          black: p.black,
          result: 0.5 as const,
          white: p.white,
        }));
        games = [...games, roundGames];
      }

      // Verify no rematches across all 3 rounds
      const allPairs = new Set<string>();
      for (const roundGames of games) {
        for (const g of roundGames) {
          const key = [g.white, g.black].toSorted().join('-');
          expect(allPairs.has(key)).toBe(false);
          allPairs.add(key);
        }
      }
    });
  });

  describe('bracket pairing (lexicographic order)', () => {
    it('pairs 4 teams with no prior games in lexicographic order', () => {
      // Same lexicographic first pairing as double-swiss: A-C and B-D
      const result = pair(FOUR_TEAMS, []);
      expect(hasPair(result.pairings, 'A', 'C')).toBe(true);
      expect(hasPair(result.pairings, 'B', 'D')).toBe(true);
    });
  });
});
