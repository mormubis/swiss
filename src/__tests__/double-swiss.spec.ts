import { describe, expect, it } from 'vitest';

import { pair } from '../double-swiss.js';

import type { Game, Player } from '../types.js';

/** Returns true if the given pairings contain a specific pair (order-insensitive). */
function hasPair(
  pairings: ReturnType<typeof pair>['pairings'],
  a: string,
  b: string,
): boolean {
  return pairings.some(
    (p) =>
      (p.whiteId === a && p.blackId === b) ||
      (p.whiteId === b && p.blackId === a),
  );
}

const FOUR_PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

const THREE_PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
];

describe('doubleSwiss', () => {
  describe('validation', () => {
    it('throws RangeError when fewer than 2 players', () => {
      expect(() => pair([FOUR_PLAYERS[0]!], [])).toThrow(RangeError);
    });
  });

  describe('even player count', () => {
    it('produces no byes when player count is even', () => {
      const result = pair(FOUR_PLAYERS, []);
      expect(result.byes).toHaveLength(0);
    });

    it('produces correct number of pairings for even players', () => {
      const result = pair(FOUR_PLAYERS, []);
      expect(result.pairings).toHaveLength(2);
    });

    it('each player appears exactly once across all pairings', () => {
      const result = pair(FOUR_PLAYERS, []);
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      expect(new Set(allIds).size).toBe(4);
      expect(allIds).toHaveLength(4);
    });
  });

  describe('PAB (bye) assignment', () => {
    it('assigns a bye when player count is odd', () => {
      const result = pair(THREE_PLAYERS, []);
      expect(result.byes).toHaveLength(1);
    });

    it('assigns bye to player with largest TPN (highest original index) when all tied', () => {
      // All players start with 0 score — largest TPN wins the bye (C at index 2)
      const result = pair(THREE_PLAYERS, []);
      expect(result.byes[0]?.playerId).toBe('C');
    });

    it('prefers lowest-score player for bye', () => {
      const fivePlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
      ];
      // A and B each get 1 from draws; C and D each get 1 from draws; E=0
      const round1Games: Game[] = [
        { blackId: 'B', result: 0.5, whiteId: 'A' },
        { blackId: 'A', result: 0.5, whiteId: 'B' },
        { blackId: 'D', result: 0.5, whiteId: 'C' },
        { blackId: 'C', result: 0.5, whiteId: 'D' },
      ];
      // Scores: A=1, B=1, C=1, D=1, E=0
      // Only E has score 0 → E gets the bye
      const result = pair(fivePlayers, [round1Games]);
      expect(result.byes[0]?.playerId).toBe('E');
    });

    it('does not assign bye to player who already received one (C2 rule)', () => {
      // C already received a bye in round 1 — should not get another
      const round1Games: Game[] = [
        { blackId: '', result: 1, whiteId: 'C' },
        { blackId: '', result: 0.5, whiteId: 'C' },
      ];
      const result = pair(THREE_PLAYERS, [round1Games]);
      expect(result.byes[0]?.playerId).not.toBe('C');
    });

    it('prefers player with most matches played when scores tie', () => {
      // B=0 (1 match), E=0 (0 matches) → B gets bye (more matches)
      const fivePlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
      ];
      const round1Games: Game[] = [
        { blackId: 'B', result: 1, whiteId: 'A' },
        { blackId: 'A', result: 0, whiteId: 'B' },
        { blackId: 'D', result: 0.5, whiteId: 'C' },
        { blackId: 'C', result: 0.5, whiteId: 'D' },
      ];
      const result = pair(fivePlayers, [round1Games]);
      expect(result.byes[0]?.playerId).toBe('B');
    });
  });

  describe('bracket pairing', () => {
    it('pairs 4 players with no prior games in lexicographic order', () => {
      // Lexicographically first valid pairing: A-C and B-D
      const result = pair(FOUR_PLAYERS, []);
      expect(hasPair(result.pairings, 'A', 'C')).toBe(true);
      expect(hasPair(result.pairings, 'B', 'D')).toBe(true);
    });

    it('avoids rematches (C1) when finding lexicographic pairing', () => {
      // Prior pairings: A-C and B-D → lex-first is illegal → next lex: A-D and B-C
      const round1Games: Game[] = [
        { blackId: 'C', result: 0.5, whiteId: 'A' },
        { blackId: 'A', result: 0.5, whiteId: 'C' },
        { blackId: 'D', result: 0.5, whiteId: 'B' },
        { blackId: 'B', result: 0.5, whiteId: 'D' },
      ];
      const result = pair(FOUR_PLAYERS, [round1Games]);
      expect(hasPair(result.pairings, 'A', 'D')).toBe(true);
      expect(hasPair(result.pairings, 'B', 'C')).toBe(true);
    });

    it('pairs 6 players all same score in lexicographic order', () => {
      const sixPlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
        { id: 'F', rating: 1500 },
      ];
      const result = pair(sixPlayers, []);
      expect(result.byes).toHaveLength(0);
      expect(result.pairings).toHaveLength(3);
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      expect(new Set(allIds).size).toBe(6);
      // Lexicographic-first pairing: {A-D, B-E, C-F}
      expect(hasPair(result.pairings, 'A', 'D')).toBe(true);
      expect(hasPair(result.pairings, 'B', 'E')).toBe(true);
      expect(hasPair(result.pairings, 'C', 'F')).toBe(true);
    });

    it('pulls upfloater from next score group when top group is odd-sized', () => {
      const fivePlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
      ];
      // A has score 2 (2 wins), B=C=1 (1 draw each), D=E=0
      const round1Games: Game[] = [
        { blackId: 'E', result: 1, whiteId: 'A' },
        { blackId: 'A', result: 0, whiteId: 'E' },
        { blackId: 'C', result: 0.5, whiteId: 'B' },
        { blackId: 'B', result: 0.5, whiteId: 'C' },
      ];
      const result = pair(fivePlayers, [round1Games]);
      expect(result.pairings).toHaveLength(2);
      expect(result.byes).toHaveLength(1);
      // A must be paired with someone
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      expect(allIds).toContain('A');
    });
  });

  describe('match model', () => {
    it('bye produces 1 entry in byes array with two game entries in input', () => {
      const players = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
      ];
      const result = pair(players, []);
      expect(result.byes).toHaveLength(1);
      expect(result.pairings).toHaveLength(1);
    });
  });

  describe('invariants', () => {
    it('never pairs the same two players twice across rounds', () => {
      const result1 = pair(FOUR_PLAYERS, []);
      const round1Games: Game[] = [];
      for (const p of result1.pairings) {
        round1Games.push(
          { blackId: p.blackId, result: 0.5, whiteId: p.whiteId },
          { blackId: p.whiteId, result: 0.5, whiteId: p.blackId },
        );
      }
      const result2 = pair(FOUR_PLAYERS, [round1Games]);
      for (const p2 of result2.pairings) {
        const isRematch = result1.pairings.some(
          (p1) =>
            (p1.whiteId === p2.whiteId && p1.blackId === p2.blackId) ||
            (p1.whiteId === p2.blackId && p1.blackId === p2.whiteId),
        );
        expect(isRematch).toBe(false);
      }
    });

    it('no byes when even player count', () => {
      const result4 = pair(FOUR_PLAYERS, []);
      expect(result4.byes).toHaveLength(0);

      const sixPlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
        { id: 'F', rating: 1500 },
      ];
      const result6 = pair(sixPlayers, []);
      expect(result6.byes).toHaveLength(0);
    });

    it('all players appear exactly once per round (even count)', () => {
      const result = pair(FOUR_PLAYERS, []);
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      const playerIds = FOUR_PLAYERS.map((p) => p.id).toSorted();
      expect(allIds.toSorted()).toStrictEqual(playerIds);
    });

    it('all players appear exactly once per round (odd count)', () => {
      const result = pair(THREE_PLAYERS, []);
      const pairedIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      const byeIds = result.byes.map((b) => b.playerId);
      const allIds = [...pairedIds, ...byeIds].toSorted();
      const playerIds = THREE_PLAYERS.map((p) => p.id).toSorted();
      expect(allIds).toStrictEqual(playerIds);
    });

    it('works with 2 players (minimum)', () => {
      const result = pair(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        [],
      );
      expect(result.pairings).toHaveLength(1);
      expect(result.byes).toHaveLength(0);
    });
  });

  describe('multi-round simulation', () => {
    it('can pair 3 rounds of a 6-player tournament', () => {
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
        const roundGames: Game[] = [];
        for (const p of result.pairings) {
          roundGames.push(
            { blackId: p.blackId, result: 0.5, whiteId: p.whiteId },
            { blackId: p.whiteId, result: 0.5, whiteId: p.blackId },
          );
        }
        games = [...games, roundGames];
      }

      // Verify no rematches across all 3 rounds
      const allPairs = new Set<string>();
      for (const roundGames of games) {
        const pairs = new Set<string>();
        for (const g of roundGames) {
          const key = [g.whiteId, g.blackId].toSorted().join('-');
          pairs.add(key);
        }
        for (const pairKey of pairs) {
          expect(allPairs.has(pairKey)).toBe(false);
          allPairs.add(pairKey);
        }
      }
    });
  });

  describe('color allocation', () => {
    it('round 1 — HRP with odd TPN (4.3.1): HRP gets White', () => {
      // A is TPN=0 (1-based: 1, odd), B is TPN=1 (1-based: 2, even)
      // No prior games — 4.3.1 applies
      // HRP: A vs B score tied at 0, A has smaller TPN → A is HRP
      // HRP has odd TPN (1-based = 1) → A gets White
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const result = pair(players, []);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.whiteId).toBe('A');
      expect(pairing!.blackId).toBe('B');
    });

    it('round 1 — HRP with even TPN (4.3.1): HRP gets Black', () => {
      // B received a bye in round 1 → B has higher score → B is HRP with even TPN (2) → B gets Black
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const round1Games: Game[] = [
        // B received a bye in round 1 — gives score but no match color history
        { blackId: '', result: 1, whiteId: 'B' },
        { blackId: '', result: 0.5, whiteId: 'B' },
      ];
      // Scores: A=0, B=1.5; matchColorHistory: A=[], B=[] (byes excluded)
      // Round 2: A vs B haven't faced each other → paired.
      // B (HRP) has even 1-based TPN (2) → B gets Black → A gets White.
      const result = pair(players, [round1Games]);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.whiteId).toBe('A');
      expect(pairing!.blackId).toBe('B');
    });

    it('fewer Whites (4.3.2): player with fewer Whites gets White', () => {
      // A has 2 white match colors, B has 0 → B gets White in round 3
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
      ];
      const round1Games: Game[] = [
        // Round 1: A(white) vs C — A match color = white
        { blackId: 'C', result: 0.5, whiteId: 'A' },
        { blackId: 'A', result: 0.5, whiteId: 'C' },
        // Round 1: D(white) vs B — B match color = black
        { blackId: 'B', result: 0.5, whiteId: 'D' },
        { blackId: 'D', result: 0.5, whiteId: 'B' },
      ];
      const round2Games: Game[] = [
        // Round 2: A(white) vs D — A gets another white match color
        { blackId: 'D', result: 0.5, whiteId: 'A' },
        { blackId: 'A', result: 0.5, whiteId: 'D' },
        // Round 2: C(white) vs B — B gets another black match color
        { blackId: 'B', result: 0.5, whiteId: 'C' },
        { blackId: 'C', result: 0.5, whiteId: 'B' },
      ];
      // Round 3: only valid pairings avoid rematches: A-B and C-D
      // A has 2 whites, B has 0 whites → 4.3.2: B has fewer whites → B gets White
      const result = pair(players, [round1Games, round2Games]);
      const avsBpairing = result.pairings.find(
        (p) =>
          (p.whiteId === 'A' && p.blackId === 'B') ||
          (p.whiteId === 'B' && p.blackId === 'A'),
      );
      expect(avsBpairing).toBeDefined();
      expect(avsBpairing!.whiteId).toBe('B');
      expect(avsBpairing!.blackId).toBe('A');
    });

    it('alternation from HRP last round (4.3.4): HRP alternates from last match', () => {
      // A and B both had match-level colors [white, white] → no divergence → 4.3.4
      // A is HRP (smaller TPN), A last match = white → A gets Black
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
      ];
      const round1Games: Game[] = [
        // Round 1: A(white) vs C — A gets white match color
        { blackId: 'C', result: 0.5, whiteId: 'A' },
        { blackId: 'A', result: 0.5, whiteId: 'C' },
        // Round 1: B(white) vs D — B gets white match color
        { blackId: 'D', result: 0.5, whiteId: 'B' },
        { blackId: 'B', result: 0.5, whiteId: 'D' },
      ];
      const round2Games: Game[] = [
        // Round 2: A(white) vs D — A gets white match color again
        { blackId: 'D', result: 0.5, whiteId: 'A' },
        { blackId: 'A', result: 0.5, whiteId: 'D' },
        // Round 2: B(white) vs C — B gets white match color again
        { blackId: 'C', result: 0.5, whiteId: 'B' },
        { blackId: 'B', result: 0.5, whiteId: 'C' },
      ];
      // Round 3: A-B paired, matchColorHistory: A=['white','white'], B=['white','white']
      // 4.3.4: A is HRP, last match = white → A gets Black
      const result = pair(players, [round1Games, round2Games]);
      const avsBpairing = result.pairings.find(
        (p) =>
          (p.whiteId === 'A' && p.blackId === 'B') ||
          (p.whiteId === 'B' && p.blackId === 'A'),
      );
      expect(avsBpairing).toBeDefined();
      expect(avsBpairing!.blackId).toBe('A');
      expect(avsBpairing!.whiteId).toBe('B');
    });
  });
});
