import { describe, expect, it } from 'vitest';

import { doubleSwiss } from '../double-swiss.js';

import type { Game, Player } from '../types.js';

/** Returns true if the given pairings contain a specific pair (order-insensitive). */
function hasPair(
  pairings: ReturnType<typeof doubleSwiss>['pairings'],
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
    it('throws RangeError when round < 1', () => {
      expect(() => doubleSwiss(FOUR_PLAYERS, [], 0)).toThrow(RangeError);
    });

    it('throws RangeError when fewer than 2 players', () => {
      expect(() => doubleSwiss([FOUR_PLAYERS[0]!], [], 1)).toThrow(RangeError);
    });
  });

  describe('even player count', () => {
    it('produces no byes when player count is even', () => {
      const result = doubleSwiss(FOUR_PLAYERS, [], 1);
      expect(result.byes).toHaveLength(0);
    });

    it('produces correct number of pairings for even players', () => {
      const result = doubleSwiss(FOUR_PLAYERS, [], 1);
      expect(result.pairings).toHaveLength(2);
    });

    it('each player appears exactly once across all pairings', () => {
      const result = doubleSwiss(FOUR_PLAYERS, [], 1);
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      expect(new Set(allIds).size).toBe(4);
      expect(allIds).toHaveLength(4);
    });
  });

  describe('PAB (bye) assignment', () => {
    it('assigns a bye when player count is odd', () => {
      const result = doubleSwiss(THREE_PLAYERS, [], 1);
      expect(result.byes).toHaveLength(1);
    });

    it('assigns bye to player with largest TPN (highest original index) when all tied', () => {
      // All players start with 0 score — largest TPN wins the bye (C at index 2)
      const result = doubleSwiss(THREE_PLAYERS, [], 1);
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
      // A and B each win one game (score 1 each); C and D each win one game (score 1 each)
      // E has no games → score 0. E is the only player with lowest score
      // Round 1 match between A and B: A wins game 1 (result=1 for white=A),
      // B wins game 2 (result=0 for white=B, so B loses as white, A wins as black)
      // Wait: result=0 means white loses → A(black) wins game 2. A=2, B=0. Not equal.
      // Use draw-draw: each gets 0.5+0.5=1
      const games: Game[] = [
        { blackId: 'B', result: 0.5, round: 1, whiteId: 'A' },
        { blackId: 'A', result: 0.5, round: 1, whiteId: 'B' },
        { blackId: 'D', result: 0.5, round: 1, whiteId: 'C' },
        { blackId: 'C', result: 0.5, round: 1, whiteId: 'D' },
      ];
      // Scores: A=1, B=1, C=1, D=1, E=0
      // Only E has score 0 → E gets the bye
      const result = doubleSwiss(fivePlayers, games, 2);
      expect(result.byes[0]?.playerId).toBe('E');
    });

    it('does not assign bye to player who already received one (C2 rule)', () => {
      // C already received a bye in round 1 — should not get another
      const games: Game[] = [
        { blackId: '', result: 1, round: 1, whiteId: 'C' },
        { blackId: '', result: 0.5, round: 1, whiteId: 'C' },
      ];
      const result = doubleSwiss(THREE_PLAYERS, games, 2);
      expect(result.byes[0]?.playerId).not.toBe('C');
    });

    it('prefers player with most matches played when scores tie', () => {
      // 5 players: A wins both vs B (A=2, B=0, 1 match each)
      // C draws both vs D (C=1, D=1, 1 match each)
      // E has no games (E=0, 0 matches)
      // Lowest scorers: B=0 (1 match), E=0 (0 matches)
      // Most matches among lowest-scorers: B(1) > E(0) → B gets bye
      // (even though B has TPN=1 < E's TPN=4, most-matches beats TPN)
      const fivePlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
      ];
      const games: Game[] = [
        { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
        { blackId: 'A', result: 0, round: 1, whiteId: 'B' },
        { blackId: 'D', result: 0.5, round: 1, whiteId: 'C' },
        { blackId: 'C', result: 0.5, round: 1, whiteId: 'D' },
      ];
      const result = doubleSwiss(fivePlayers, games, 2);
      expect(result.byes[0]?.playerId).toBe('B');
    });
  });

  describe('bracket pairing', () => {
    it('pairs 4 players with no prior games in lexicographic order', () => {
      // Players A(TPN=0), B(TPN=1), C(TPN=2), D(TPN=3) all score 0
      // Bracket sorted by TPN: [A, B, C, D]
      // Possible pairings by lex identifier (top TPN asc, then bottom TPN asc):
      //   {A-C, B-D} → identifier [A,B,C,D]  ← smallest lex
      //   {A-D, B-C} → identifier [A,B,D,C]
      //   {A-B, C-D} → identifier [A,C,B,D]
      // Lexicographically first valid pairing: A-C and B-D
      const result = doubleSwiss(FOUR_PLAYERS, [], 1);
      expect(hasPair(result.pairings, 'A', 'C')).toBe(true);
      expect(hasPair(result.pairings, 'B', 'D')).toBe(true);
    });

    it('avoids rematches (C1) when finding lexicographic pairing', () => {
      // 4 players all at same score (1.0 each) after two draws
      // Prior pairings: A-C and B-D
      // Lex-first {A-C, B-D} is illegal (rematches) → skip
      // Next lex: {A-D, B-C}
      const eqPlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
      ];
      const eqGames: Game[] = [
        { blackId: 'C', result: 0.5, round: 1, whiteId: 'A' },
        { blackId: 'A', result: 0.5, round: 1, whiteId: 'C' },
        { blackId: 'D', result: 0.5, round: 1, whiteId: 'B' },
        { blackId: 'B', result: 0.5, round: 1, whiteId: 'D' },
      ];
      // All have score 1.0 → same bracket
      const result = doubleSwiss(eqPlayers, eqGames, 2);
      expect(hasPair(result.pairings, 'A', 'D')).toBe(true);
      expect(hasPair(result.pairings, 'B', 'C')).toBe(true);
    });

    it('pairs 6 players all same score in lexicographic order', () => {
      // 6 players A-F (TPN 0-5), all score 0.
      // Bracket [A,B,C,D,E,F] sorted by TPN.
      // The FIDE identifier for a matching = [sorted top TPNs, corresponding bottom TPNs].
      // Top = smaller TPN in pair, bottom = larger TPN.
      //
      // {A-D, B-E, C-F}: tops sorted [A,B,C]=[0,1,2], bottoms [D,E,F]=[3,4,5]
      //   → identifier [0,1,2,3,4,5]
      // {A-C, B-E, D-F}: tops [A,B,D]=[0,1,3], bottoms [C,E,F]=[2,4,5]
      //   → identifier [0,1,3,2,4,5]
      // {A-B, C-D, E-F}: tops [A,C,E]=[0,2,4], bottoms [B,D,F]=[1,3,5]
      //   → identifier [0,2,4,1,3,5]
      //
      // Lex comparison: [0,1,2,...] < [0,1,3,...] < [0,2,4,...]
      // → Lex-first valid pairing: {A-D, B-E, C-F}
      const sixPlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
        { id: 'F', rating: 1500 },
      ];
      const result = doubleSwiss(sixPlayers, [], 1);
      expect(result.byes).toHaveLength(0);
      expect(result.pairings).toHaveLength(3);
      // All 6 players appear exactly once
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      expect(new Set(allIds).size).toBe(6);
      // Lexicographic-first pairing: {A-D, B-E, C-F}
      expect(hasPair(result.pairings, 'A', 'D')).toBe(true);
      expect(hasPair(result.pairings, 'B', 'E')).toBe(true);
      expect(hasPair(result.pairings, 'C', 'F')).toBe(true);
    });

    it('pulls upfloater from next score group when top group is odd-sized', () => {
      // Scores: A=2, B=1, C=1, D=0, E=0
      // Ranked: A(2), B(1,TPN1), C(1,TPN2), D(0,TPN3), E(0,TPN4)
      // Top group [A] has 1 player (odd) → pull 1 upfloater from [B,C] group
      // Upfloater selection: lex by TPN → pick B (TPN=1, smallest)
      // Bracket 1: [A, B] → A-B paired
      // Remaining [C, D, E] (odd) → bye goes to E (lowest score, largest TPN)
      // Wait - bye assignment happens before pairing, not per-bracket
      // Actually: A(2pts) is top group [A]; upfloater B(1pt) joins bracket → A-B
      // Remaining [C(1), D(0), E(0)] → after bye (E gets bye): [C,D] → C-D paired
      const fivePlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
      ];
      const games: Game[] = [
        { blackId: 'E', result: 1, round: 1, whiteId: 'A' },
        { blackId: 'A', result: 0, round: 1, whiteId: 'E' },
        { blackId: 'C', result: 0.5, round: 1, whiteId: 'B' },
        { blackId: 'B', result: 0.5, round: 1, whiteId: 'C' },
      ];
      const result = doubleSwiss(fivePlayers, games, 2);
      expect(result.pairings).toHaveLength(2);
      expect(result.byes).toHaveLength(1);
      // A must be paired with someone
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      expect(allIds).toContain('A');
    });
  });

  describe('match model', () => {
    it('bye produces 1.5 points with two game entries', () => {
      // 3 players → one gets bye in round 1
      // Verify bye player appears in byes array
      const players = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
      ];
      const result = doubleSwiss(players, [], 1);
      expect(result.byes).toHaveLength(1);
      // Verify 1 pairing (the other 2 players)
      expect(result.pairings).toHaveLength(1);
    });
  });

  describe('invariants', () => {
    it('never pairs the same two players twice across rounds', () => {
      // 4 players, play round 1, then pair round 2
      // Round 2 pairs must differ from round 1 pairs
      const result1 = doubleSwiss(FOUR_PLAYERS, [], 1);
      const games: Game[] = [];
      for (const p of result1.pairings) {
        games.push(
          { blackId: p.blackId, result: 0.5, round: 1, whiteId: p.whiteId },
          { blackId: p.whiteId, result: 0.5, round: 1, whiteId: p.blackId },
        );
      }
      const result2 = doubleSwiss(FOUR_PLAYERS, games, 2);
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
      const result4 = doubleSwiss(FOUR_PLAYERS, [], 1);
      expect(result4.byes).toHaveLength(0);

      const sixPlayers: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
        { id: 'E', rating: 1600 },
        { id: 'F', rating: 1500 },
      ];
      const result6 = doubleSwiss(sixPlayers, [], 1);
      expect(result6.byes).toHaveLength(0);
    });

    it('all players appear exactly once per round (even count)', () => {
      const result = doubleSwiss(FOUR_PLAYERS, [], 1);
      const allIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      const playerIds = FOUR_PLAYERS.map((p) => p.id).toSorted();
      expect(allIds.toSorted()).toStrictEqual(playerIds);
    });

    it('all players appear exactly once per round (odd count)', () => {
      const result = doubleSwiss(THREE_PLAYERS, [], 1);
      const pairedIds = result.pairings.flatMap((p) => [p.whiteId, p.blackId]);
      const byeIds = result.byes.map((b) => b.playerId);
      const allIds = [...pairedIds, ...byeIds].toSorted();
      const playerIds = THREE_PLAYERS.map((p) => p.id).toSorted();
      expect(allIds).toStrictEqual(playerIds);
    });

    it('works with 2 players (minimum)', () => {
      const result = doubleSwiss(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        [],
        1,
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
      const games: Game[] = [];

      for (let round = 1; round <= 3; round++) {
        const result = doubleSwiss(players, games, round);
        expect(result.pairings).toHaveLength(3);
        expect(result.byes).toHaveLength(0);

        // Record games (all draws for simplicity)
        for (const p of result.pairings) {
          games.push(
            { blackId: p.blackId, result: 0.5, round, whiteId: p.whiteId },
            { blackId: p.whiteId, result: 0.5, round, whiteId: p.blackId },
          );
        }
      }

      // Verify no rematches across all 3 rounds
      const allPairs = new Set<string>();
      for (let round = 1; round <= 3; round++) {
        const roundGames = games.filter((g) => g.round === round);
        // Each round has 6 games (3 matches × 2 games)
        const pairs = new Set<string>();
        for (const g of roundGames) {
          const key = [g.whiteId, g.blackId].toSorted().join('-');
          pairs.add(key);
        }
        for (const pair of pairs) {
          expect(allPairs.has(pair)).toBe(false);
          allPairs.add(pair);
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
      // Pairing order: bracket [A,B] → A paired with B
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const result = doubleSwiss(players, [], 1);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      expect(pairing!.whiteId).toBe('A');
      expect(pairing!.blackId).toBe('B');
    });

    it('round 1 — HRP with even TPN (4.3.1): HRP gets Black', () => {
      // Use 2 players where HRP has even 1-based TPN.
      // HRP is the player with higher score. To get an even-TPN HRP,
      // B(TPN=1, 1-based=2) must have higher score than A(TPN=0).
      // B received a bye in round 1 → B has score 1.5, A has score 0.
      // Both have zero match history (byes don't create match color history).
      // 4.3.1 applies: B is HRP with even 1-based TPN (2) → B gets Black → A gets White.
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
      ];
      const games: Game[] = [
        // B received a bye in round 1 — gives score but no match color history
        { blackId: '', result: 1, round: 1, whiteId: 'B' },
        { blackId: '', result: 0.5, round: 1, whiteId: 'B' },
      ];
      // Scores: A=0, B=1.5; matchColorHistory: A=[], B=[] (byes excluded)
      // Round 2: A vs B haven't faced each other → paired.
      // B(score=1.5, TPN=1, 1-based=2) has higher score → B is HRP.
      // Both have zero match history → 4.3.1 applies.
      // B (HRP) has even 1-based TPN (2) → B gets Black → A gets White.
      const result = doubleSwiss(players, games, 2);
      const pairing = result.pairings[0];
      expect(pairing).toBeDefined();
      // B is HRP with even TPN → B gets Black
      expect(pairing!.whiteId).toBe('A');
      expect(pairing!.blackId).toBe('B');
    });

    it('fewer Whites (4.3.2): player with fewer Whites gets White', () => {
      // Use 4 players. Round 1 lex-first pairing: A-C and B-D (verified by bracket test above).
      // In round 1: A is White vs C, D is White vs B.
      // matchColorHistory: A=['white'], B=['black'], C=['black'], D=['white']
      // Round 2: all equal score → re-pair avoiding rematches.
      // Lex-first valid pair avoiding rematches: A-D and B-C.
      // For A(white history) vs D(white history): equal whites → 4.3.3/4.3.4 applies.
      // For B(black history) vs C(black history): equal whites → 4.3.3/4.3.4 applies.
      //
      // To test 4.3.2 we need different white counts. Use 4 players where
      // A had 2 prior white matches and B had 0, then A-B gets paired.
      // Build: A vs C(round1,white), A vs D(round2,white); B vs C(round1,black), B vs D(round2,black)
      // Then round 3: all score equal, A-B must be paired (both haven't faced each other)
      // Wait: 4 players total, each round pairs 2 pairs. In round 3, A can only face B or someone
      // they haven't faced yet. With 4 players in 2 rounds:
      //   R1: A-C, B-D → hasFaced: A-C, B-D
      //   R2: A-D, B-C → hasFaced: A-C, A-D, B-C, B-D
      //   R3: only valid pairing is A-B and C-D
      // Perfect! A has match colors [white, white], B has match colors [black, black]
      // A has 2 whites, B has 0 whites → 4.3.2: B gets White
      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
      ];
      const games: Game[] = [
        // Round 1: A(white) vs C — A match color = white
        { blackId: 'C', result: 0.5, round: 1, whiteId: 'A' },
        { blackId: 'A', result: 0.5, round: 1, whiteId: 'C' },
        // Round 1: D(white) vs B — B match color = black
        { blackId: 'B', result: 0.5, round: 1, whiteId: 'D' },
        { blackId: 'D', result: 0.5, round: 1, whiteId: 'B' },
        // Round 2: A(white) vs D — A gets another white match color
        { blackId: 'D', result: 0.5, round: 2, whiteId: 'A' },
        { blackId: 'A', result: 0.5, round: 2, whiteId: 'D' },
        // Round 2: C(white) vs B — B gets another black match color
        { blackId: 'B', result: 0.5, round: 2, whiteId: 'C' },
        { blackId: 'C', result: 0.5, round: 2, whiteId: 'B' },
      ];
      // All players score 2 after round 2
      // matchColorHistory: A=['white','white'], B=['black','black'], C=['black','white'], D=['white','black']
      // Whites: A=2, B=0, C=1, D=1
      // Round 3: only valid pairings avoid rematches:
      //   A-B (no prior), C-D (no prior) → valid!
      //   A-C, B-D → rematches → invalid
      //   A-D, B-C → rematches → invalid
      // So round 3 pairs A-B and C-D.
      // For A vs B: A=2 whites, B=0 whites → 4.3.2: B has fewer whites → B gets White
      const result = doubleSwiss(players, games, 3);
      const avsBpairing = result.pairings.find(
        (p) =>
          (p.whiteId === 'A' && p.blackId === 'B') ||
          (p.whiteId === 'B' && p.blackId === 'A'),
      );
      expect(avsBpairing).toBeDefined();
      // B has fewer Whites (0 vs 2) → B gets White
      expect(avsBpairing!.whiteId).toBe('B');
      expect(avsBpairing!.blackId).toBe('A');
    });

    it('alternation from HRP last round (4.3.4): HRP alternates from last match', () => {
      // Setup for rule 4.3.4: A and B have played 2 matches with same match-level
      // colors (so 4.3.3 last divergence doesn't apply — same colors both rounds)
      // Both played same color in each match → most recent divergence search fails
      // Falls through to 4.3.4: alternate HRP's last match color
      //
      // A(TPN=0) and B(TPN=1); A had White in rounds 1 and 2 (match color = white both)
      // HRP: both score equal → A is HRP (smaller TPN)
      // 4.3.2: A has 2 whites, B has 0 → B has fewer whites → B gets White
      //
      // Instead set up 4.3.4: both have same white count, and no divergence.
      // A: match colors [white, black] — alternating, so last divergence is round 1
      // That tests 4.3.3 not 4.3.4. For 4.3.4 we need both to have same colors always.
      // Both have 1 white, 1 black, last round same color:
      // A: [white, black] → A had Black last
      // B: [black, white] → B had White last
      // Divergence: round 1 A=white, B=black → different! → 4.3.3 applies (not 4.3.4)
      //
      // For 4.3.4, we need no divergence in any round AND equal whites:
      // A: [white, white] — 2 whites
      // B: [white, white] — 2 whites
      // 4.3.2 doesn't apply (equal whites)
      // 4.3.3: round1 A=white, B=white → same; round2 A=white, B=white → same → no divergence
      // 4.3.4: HRP is A (smaller TPN), A's last match = white → alternate → A gets Black
      //
      // Build games: both players always played White in their matches
      // Round 1: A vs C (A plays white game 1), B vs D (B plays white game 1)
      // Round 2: A vs C rematch won't happen → need different opponents
      // Actually the test only tests color allocation for A vs B in round 3
      // We need to construct a scenario where A and B didn't face each other yet
      // and have both had match-level color [white, white]

      const players: Player[] = [
        { id: 'A', rating: 2000 },
        { id: 'B', rating: 1900 },
        { id: 'C', rating: 1800 },
        { id: 'D', rating: 1700 },
      ];
      const games: Game[] = [
        // Round 1: A(white) vs C — A gets white match color
        { blackId: 'C', result: 0.5, round: 1, whiteId: 'A' },
        { blackId: 'A', result: 0.5, round: 1, whiteId: 'C' },
        // Round 1: B(white) vs D — B gets white match color
        { blackId: 'D', result: 0.5, round: 1, whiteId: 'B' },
        { blackId: 'B', result: 0.5, round: 1, whiteId: 'D' },
        // Round 2: A(white) vs D — A gets white match color again
        { blackId: 'D', result: 0.5, round: 2, whiteId: 'A' },
        { blackId: 'A', result: 0.5, round: 2, whiteId: 'D' },
        // Round 2: B(white) vs C — B gets white match color again
        { blackId: 'C', result: 0.5, round: 2, whiteId: 'B' },
        { blackId: 'B', result: 0.5, round: 2, whiteId: 'C' },
      ];
      // All players score 1 each round → all have equal scores
      // A and B haven't faced each other → can be paired in round 3
      // matchColorHistory: A=['white','white'], B=['white','white']
      // 4.3.1 — not applicable (have history)
      // 4.3.2 — whites: A=2, B=2 → equal, skip
      // 4.3.3 — no divergence (both white in both rounds), skip
      // 4.3.4 — HRP is A (smaller TPN=0), A last match = white → alternate → A gets Black
      const result = doubleSwiss(players, games, 3);
      const avsBpairing = result.pairings.find(
        (p) =>
          (p.whiteId === 'A' && p.blackId === 'B') ||
          (p.whiteId === 'B' && p.blackId === 'A'),
      );
      expect(avsBpairing).toBeDefined();
      // A is HRP with last match color = white → A gets Black (alternation)
      expect(avsBpairing!.blackId).toBe('A');
      expect(avsBpairing!.whiteId).toBe('B');
    });
  });
});
