import { describe, expect, it } from 'vitest';

import { swissTeam } from '../swiss-team.js';

import type { Game, Player } from '../types.js';

/** Returns true if the given pairings contain a specific pair (order-insensitive). */
function hasPair(
  pairings: ReturnType<typeof swissTeam>['pairings'],
  a: string,
  b: string,
): boolean {
  return pairings.some(
    (p) =>
      (p.whiteId === a && p.blackId === b) ||
      (p.whiteId === b && p.blackId === a),
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
    it('throws RangeError when round < 1', () => {
      expect(() => swissTeam(FOUR_TEAMS, [], 0)).toThrow(RangeError);
    });

    it('throws RangeError when fewer than 2 teams', () => {
      expect(() => swissTeam([FOUR_TEAMS[0]!], [], 1)).toThrow(RangeError);
    });
  });

  describe('even team count', () => {
    it('produces no byes when team count is even', () => {
      const result = swissTeam(FOUR_TEAMS, [], 1);
      expect(result.byes).toHaveLength(0);
    });

    it('produces correct number of pairings for 4 teams', () => {
      const result = swissTeam(FOUR_TEAMS, [], 1);
      expect(result.pairings).toHaveLength(2);
    });

    it('each team appears exactly once across all pairings', () => {
      const result = swissTeam(FOUR_TEAMS, [], 1);
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      expect(new Set(allIds).size).toBe(4);
      expect(allIds).toHaveLength(4);
    });
  });

  describe('odd team count (bye)', () => {
    it('assigns a bye when team count is odd', () => {
      const result = swissTeam(THREE_TEAMS, [], 1);
      expect(result.byes).toHaveLength(1);
    });

    it('assigns bye to team with largest TPN when all score is tied', () => {
      // All teams start with 0 score — largest TPN wins the bye (C at index 2)
      const result = swissTeam(THREE_TEAMS, [], 1);
      expect(result.byes[0]?.playerId).toBe('C');
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
      const games: Game[] = [
        { blackId: 'B', result: 0.5, round: 1, whiteId: 'A' },
        { blackId: 'D', result: 0.5, round: 1, whiteId: 'C' },
      ];
      const result = swissTeam(fiveTeams, games, 2);
      expect(result.byes[0]?.playerId).toBe('E');
    });

    it('prefers team with most matches played when scores tie (lowest score)', () => {
      // A beats B (A=1, B=0, 1 match each); C draws D (C=0.5, D=0.5, 1 match)
      // E has no games (E=0, 0 matches)
      // Lowest scorers: B=0 (1 match), E=0 (0 matches)
      // Most matches among lowest-scorers: B(1) > E(0) → B gets bye
      const fiveTeams: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
      ];
      const games: Game[] = [
        { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
        { blackId: 'D', result: 0.5, round: 1, whiteId: 'C' },
      ];
      const result = swissTeam(fiveTeams, games, 2);
      expect(result.byes[0]?.playerId).toBe('B');
    });

    it('prefers largest TPN among tied lowest-score same-matches teams', () => {
      // 3 teams all score 0, no games. C has largest TPN → C gets bye
      const result = swissTeam(THREE_TEAMS, [], 1);
      expect(result.byes[0]?.playerId).toBe('C');
    });

    it('does not assign bye to team that already received one (C2 rule)', () => {
      // C already received a bye in round 1 — should not get another
      const games: Game[] = [
        { blackId: '', result: 1, round: 1, whiteId: 'C' },
      ];
      const result = swissTeam(THREE_TEAMS, games, 2);
      expect(result.byes[0]?.playerId).not.toBe('C');
    });
  });

  describe('color allocation — 4.3.1 (no history, TPN-based)', () => {
    it('round 1: first-team with odd 1-based TPN gets White', () => {
      // A(TPN=0, 1-based=1, odd) is first-team (same score, smaller TPN)
      // No prior games → 4.3.1: first-team with odd TPN gets White → A gets White
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const result = swissTeam(players, [], 1);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.whiteId).toBe('A');
      expect(pairing!.blackId).toBe('B');
    });

    it('round 1: first-team with even 1-based TPN gets Black', () => {
      // B(TPN=1, 1-based=2, even) is first-team because B has higher score (bye round)
      // Both have zero match history (bye excluded) → 4.3.1: even TPN → B gets Black
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const games: Game[] = [
        // B received a bye in round 1 — gives score but no match color history
        { blackId: '', result: 1, round: 1, whiteId: 'B' },
      ];
      const result = swissTeam(players, games, 2);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      // B is first-team with even 1-based TPN (2) → B gets Black → A gets White
      expect(pairing!.whiteId).toBe('A');
      expect(pairing!.blackId).toBe('B');
    });
  });

  describe('color allocation — 4.3.2 (one team has Type A preference)', () => {
    it('grants preference when only one team has Type A preference', () => {
      // A had 3 blacks (CD = -3) → Type A preference for White
      // B has no games → no preference
      // 4.3.2 applies: A gets White
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const games: Game[] = [
        { blackId: 'A', result: 0.5, round: 1, whiteId: 'X' },
        { blackId: 'A', result: 0.5, round: 2, whiteId: 'X' },
        { blackId: 'A', result: 0.5, round: 3, whiteId: 'X' },
      ];
      const result = swissTeam(players, games, 4);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.whiteId).toBe('A');
    });

    it('grants opposing preference when both have Type A preference for opposite colors', () => {
      // A had 3 blacks → wants White; B had 3 whites → wants Black
      // 4.3.3: both have opposite preferences → grant both → A White, B Black
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const games: Game[] = [
        { blackId: 'A', result: 0.5, round: 1, whiteId: 'X' },
        { blackId: 'A', result: 0.5, round: 2, whiteId: 'X' },
        { blackId: 'A', result: 0.5, round: 3, whiteId: 'X' },
        { blackId: 'X', result: 0.5, round: 1, whiteId: 'B' },
        { blackId: 'X', result: 0.5, round: 2, whiteId: 'B' },
        { blackId: 'X', result: 0.5, round: 3, whiteId: 'B' },
      ];
      const result = swissTeam(players, games, 4);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.whiteId).toBe('A');
      expect(pairing!.blackId).toBe('B');
    });
  });

  describe('color allocation — 4.3.5 (lower CD gets White)', () => {
    it('team with lower color difference gets White', () => {
      // Build scenario where 4.3.1, 4.3.2, 4.3.3 are skipped.
      // A: 1 white match, 2 black matches → CD = 1-2 = -1
      // B: 2 white matches, 1 black match → CD = 2-1 = +1
      // Neither has Type A preference (CD not extreme enough, last two don't qualify alone)
      // Wait: A has CD=-1, last two may trigger 4.3.2...
      // Let's use CD of exactly 0 vs +1 where no Type A preference applies:
      // A: 1 white, 1 black → CD=0, last two=[white,black] → no Type A pref
      // B: 2 white, 1 black → CD=1, last two=[white,black] (if alternating) → no Type A pref
      // B has higher CD (+1) > A's CD (0) → A has lower CD → A gets White? No, lower CD.
      // -2 is lower than -1, so "lower" means more negative / smaller numeric value.
      // A: CD=0; B: CD=+1 → A has lower CD (0 < +1) → A gets White
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      // A: white r1, black r2 → CD=0, last two=[white,black]
      // B: white r1, white r2, black r3 → CD=1, last two=[white,black]
      // Neither has Type A pref. CD: A=0, B=1 → A has lower CD → A gets White
      const games: Game[] = [
        { blackId: 'X', result: 0.5, round: 1, whiteId: 'A' },
        { blackId: 'A', result: 0.5, round: 2, whiteId: 'X' },
        { blackId: 'X', result: 0.5, round: 1, whiteId: 'B' },
        { blackId: 'X', result: 0.5, round: 2, whiteId: 'B' },
        { blackId: 'B', result: 0.5, round: 3, whiteId: 'X' },
      ];
      const result = swissTeam(players, games, 4);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.whiteId).toBe('A');
    });
  });

  describe('color allocation — 4.3.8 (alternate first-team color)', () => {
    it('first-team alternates from last round when other rules do not apply', () => {
      // Setup: A and B paired in round 3, with:
      // A is first-team (smaller TPN when scores equal)
      // A matchColorHistory: [white, white] → CD=+2, Type A preference: Black (CD>+1)
      // But B also has CD that creates a preference...
      // Let's build a clear 4.3.8 scenario using 4 players round 3:
      // After rounds 1&2, A has [white, black] and B has [white, black]
      // Both CD=0, no last-two-same → no Type A preference (4.3.2/4.3.3 skip)
      // CD: A=0, B=0 → equal, skip 4.3.5
      // Alternate from most recent divergence: look at history
      // A=[white,black], B=[white,black] → round1 A=white,B=white same; round2 A=black,B=black same
      // No divergence → skip 4.3.6
      // 4.3.7: grant first-team's preference — but A has no Type A preference
      // Actually for 4.3.8: we need 4.3.7 to also not apply.
      // 4.3.7 is about first-team's preference (Type A). If first-team has no Type A pref, skip.
      // 4.3.8: alternate first-team's color from last round.
      // A last match = black → alternate → A gets White
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
      ];
      const games: Game[] = [
        // Round 1: A(white) vs C, B(white) vs D
        { blackId: 'C', result: 0.5, round: 1, whiteId: 'A' },
        { blackId: 'D', result: 0.5, round: 1, whiteId: 'B' },
        // Round 2: A(black) vs D, B(black) vs C
        { blackId: 'A', result: 0.5, round: 2, whiteId: 'D' },
        { blackId: 'B', result: 0.5, round: 2, whiteId: 'C' },
      ];
      // Round 3: A hasn't faced B → can be paired
      // A matchColorHistory: [white(r1), black(r2)] → CD=0, last two=[white,black] → no pref
      // B matchColorHistory: [white(r1), black(r2)] → CD=0, last two=[white,black] → no pref
      // 4.3.1: not applicable (have history)
      // 4.3.2: neither has Type A pref → skip
      // 4.3.3: A wants neither, B wants neither → skip
      // 4.3.5: CD(A)=0, CD(B)=0 → equal → skip
      // 4.3.6: Alternate from most recent divergence:
      //   A=[white,black], B=[white,black]; r1: A=white,B=white same; r2: A=black,B=black same
      //   No divergence → skip
      // 4.3.7: first-team(A) has no Type A preference → skip
      // 4.3.8: alternate first-team(A) from last round: last=black → A gets White
      const result = swissTeam(players, games, 3);
      const pairing = result.pairings.find(
        (p) =>
          (p.whiteId === 'A' && p.blackId === 'B') ||
          (p.whiteId === 'B' && p.blackId === 'A'),
      );
      expect(pairing).toBeDefined();
      expect(pairing!.whiteId).toBe('A');
    });
  });

  describe('no rematches invariant', () => {
    it('never pairs the same two teams twice across rounds (4 teams, 2 rounds)', () => {
      const games: Game[] = [];
      const result1 = swissTeam(FOUR_TEAMS, [], 1);
      for (const p of result1.pairings) {
        games.push({
          blackId: p.blackId,
          result: 0.5,
          round: 1,
          whiteId: p.whiteId,
        });
      }
      const result2 = swissTeam(FOUR_TEAMS, games, 2);
      for (const p2 of result2.pairings) {
        const isRematch = result1.pairings.some(
          (p1) =>
            (p1.whiteId === p2.whiteId && p1.blackId === p2.blackId) ||
            (p1.whiteId === p2.blackId && p1.blackId === p2.whiteId),
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
      const games: Game[] = [];

      for (let round = 1; round <= 3; round++) {
        const result = swissTeam(players, games, round);
        expect(result.pairings).toHaveLength(3);
        expect(result.byes).toHaveLength(0);

        // Record games (all draws for simplicity)
        for (const p of result.pairings) {
          games.push({
            blackId: p.blackId,
            result: 0.5,
            round,
            whiteId: p.whiteId,
          });
        }
      }

      // Verify no rematches across all 3 rounds
      const allPairs = new Set<string>();
      for (const g of games) {
        const key = [g.whiteId, g.blackId].toSorted().join('-');
        expect(allPairs.has(key)).toBe(false);
        allPairs.add(key);
      }
    });
  });

  describe('bracket pairing (lexicographic order)', () => {
    it('pairs 4 teams with no prior games in lexicographic order', () => {
      // Same lexicographic first pairing as double-swiss: A-C and B-D
      const result = swissTeam(FOUR_TEAMS, [], 1);
      expect(hasPair(result.pairings, 'A', 'C')).toBe(true);
      expect(hasPair(result.pairings, 'B', 'D')).toBe(true);
    });
  });
});
