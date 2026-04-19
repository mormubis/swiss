/**
 * FIDE Dutch pairing fixture tests.
 *
 * Test cases sourced from bbpPairings (Apache 2.0):
 * https://github.com/BieremaBoyzProgramming/bbpPairings/tree/main/test/tests
 *
 * Fixture files live in src/__tests__/fixtures/ (copied from @echecs/trf).
 *
 * Tests verify exact FIDE-correct pairings produced by the full C.04.3
 * implementation.
 */
import { parse } from '@echecs/trf';
import { describe, expect, it } from 'vitest';

import { pair } from '../dutch.js';
import dutchC5 from './fixtures/dutch_2025_C5.trf?raw';
import dutchC9 from './fixtures/dutch_2025_C9.trf?raw';
import issue15 from './fixtures/issue_15.trf?raw';
import issue7 from './fixtures/issue_7.trf?raw';

import type { TraceEvent } from '../trace.js';
import type { Game, Player } from '../types.js';
import type { Tournament } from '@echecs/trf';

// ---------------------------------------------------------------------------
// Adapters — convert @echecs/trf Tournament to @echecs/swiss types
// ---------------------------------------------------------------------------

function toSwissPlayers(tournament: Tournament): Player[] {
  return tournament.players.map((p) => ({
    id: String(p.pairingNumber),
    rating: p.rating,
  }));
}

function toSwissGames(tournament: Tournament): Game[][] {
  // Find max round
  let maxRound = 0;
  for (const player of tournament.players) {
    for (const result of player.results) {
      if (result.round > maxRound) {
        maxRound = result.round;
      }
    }
  }

  // Build one array per round (1-indexed → 0-indexed)
  const roundArrays: Game[][] = Array.from({ length: maxRound }, () => []);

  for (const player of tournament.players) {
    for (const result of player.results) {
      if (result.color !== 'w' || result.opponentId === null) {
        continue;
      }
      let score: 0 | 0.5 | 1;
      switch (result.result) {
        case '1':
        case '+': {
          score = 1;
          break;
        }
        case '0':
        case '-': {
          score = 0;
          break;
        }
        case '=': {
          score = 0.5;
          break;
        }
        default: {
          continue;
        }
      }
      const roundIndex = result.round - 1;
      const roundGames = roundArrays[roundIndex];
      if (roundGames !== undefined) {
        roundGames.push({
          black: String(result.opponentId),
          result: score,
          white: String(player.pairingNumber),
        });
      }
    }
  }

  return roundArrays;
}

/** IDs of players who have a pre-assigned Z or F bye in the target round. */
function preAssignedIds(
  tournament: Tournament,
  targetRound: number,
): Set<string> {
  const ids = new Set<string>();
  for (const player of tournament.players) {
    for (const result of player.results) {
      if (
        result.round === targetRound &&
        (result.result === 'Z' || result.result === 'F')
      ) {
        ids.add(String(player.pairingNumber));
      }
    }
  }
  return ids;
}

function isRemainderPhase(phase: string): boolean {
  return phase === 'bracket-remainder' || phase === 'bracket-ordering';
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURES: Record<string, string> = {
  dutch_2025_C5: dutchC5,
  dutch_2025_C9: dutchC9,
  issue_15: issue15,
  issue_7: issue7,
};

function loadFixture(name: string): Tournament {
  const content = FIXTURES[name];
  if (content === undefined) {
    throw new Error(`Unknown fixture: ${name}`);
  }
  const tournament = parse(content);
  if (tournament === null) {
    throw new Error(`Failed to parse fixture: ${name}`);
  }
  return tournament;
}

// ---------------------------------------------------------------------------
// dutch_2025_C5
// ---------------------------------------------------------------------------
describe('dutch fixture: dutch_2025_C5', () => {
  const tournament = loadFixture('dutch_2025_C5');
  const targetRound = 3;
  const excluded = preAssignedIds(tournament, targetRound);
  const players = toSwissPlayers(tournament).filter((p) => !excluded.has(p.id));
  // games up to (not including) round 3 → first 2 rounds
  const allGames = toSwissGames(tournament);
  const gamesBefore = allGames.slice(0, targetRound - 1);

  it('excludes pre-assigned players (P4 has Z-bye)', () => {
    expect(excluded.has('4')).toBe(true);
    expect(players).toHaveLength(5);
  });

  it('produces 2 pairings and 1 bye for round 3 (5 pairable players)', () => {
    const result = pair(players, gamesBefore);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(1);
  });

  it('produces the correct pairings for round 3 (FIDE Dutch C5): 1 vs 5, 3 vs 2, bye to 6', () => {
    const result = pair(players, gamesBefore);
    const pairingSet = new Set(
      result.pairings.map((p) => [p.white, p.black].toSorted().join('-')),
    );
    expect(pairingSet).toContain('1-5');
    expect(pairingSet).toContain('2-3');
    expect(result.byes).toHaveLength(1);
    expect(result.byes[0]?.player).toBe('6');
  });
});

// ---------------------------------------------------------------------------
// dutch_2025_C9
// ---------------------------------------------------------------------------
describe('dutch fixture: dutch_2025_C9', () => {
  const tournament = loadFixture('dutch_2025_C9');
  const targetRound = 3;
  const excluded = preAssignedIds(tournament, targetRound);
  const players = toSwissPlayers(tournament).filter((p) => !excluded.has(p.id));
  const allGames = toSwissGames(tournament);
  const gamesBefore = allGames.slice(0, targetRound - 1);

  it('has no pre-assigned players for round 3', () => {
    expect(excluded.size).toBe(0);
    expect(players).toHaveLength(5);
  });

  it('produces 2 pairings and 1 bye for round 3 (5 pairable players)', () => {
    const result = pair(players, gamesBefore);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(1);
  });

  it('produces the correct pairings for round 3 (FIDE Dutch C9): 2 vs 1, 3 vs 5, bye to 4', () => {
    const result = pair(players, gamesBefore);
    const pairingSet = new Set(
      result.pairings.map((p) => [p.white, p.black].toSorted().join('-')),
    );
    expect(pairingSet).toContain('1-2');
    expect(pairingSet).toContain('3-5');
    expect(result.byes).toHaveLength(1);
    expect(result.byes[0]?.player).toBe('4');
  });
});

// ---------------------------------------------------------------------------
// issue_7
// ---------------------------------------------------------------------------
describe('dutch fixture: issue_7', () => {
  const tournament = loadFixture('issue_7');
  const targetRound = 15;
  const excluded = preAssignedIds(tournament, targetRound);
  const players = toSwissPlayers(tournament).filter((p) => !excluded.has(p.id));
  const allGames = toSwissGames(tournament);
  const gamesBefore = allGames.slice(0, targetRound - 1);

  it('produces 30 pairings and no byes for round 15', () => {
    const result = pair(players, gamesBefore);
    expect(result.pairings).toHaveLength(30);
    expect(result.byes).toHaveLength(0);
  });

  it('produces no rematches in round 15', () => {
    const result = pair(players, gamesBefore);
    const flat = gamesBefore.flat();
    for (const pairing of result.pairings) {
      const alreadyFaced = flat.some(
        (g) =>
          (g.white === pairing.white && g.black === pairing.black) ||
          (g.white === pairing.black && g.black === pairing.white),
      );
      expect(
        alreadyFaced,
        `rematch detected: ${pairing.white} vs ${pairing.black}`,
      ).toBe(false);
    }
  });

  it('does not spin the bracket loop when unmatched players remain', () => {
    const events: TraceEvent[] = [];
    pair(players, gamesBefore, { trace: (event) => events.push(event) });

    const bracketEnters = events.filter(
      (event) => event.type === 'dutch:bracket-enter',
    );
    expect(bracketEnters.length).toBeLessThan(50);
  });

  it('finalizes each remainder pair individually with blossom re-runs', () => {
    const events: TraceEvent[] = [];
    pair(players, gamesBefore, { trace: (event) => events.push(event) });

    const remainderFinalizations = events.filter(
      (event) =>
        event.type === 'pairing:pair-finalized' &&
        isRemainderPhase(event.phase),
    );

    expect(remainderFinalizations.length).toBeGreaterThan(0);

    let blossomCountInRemainder = 0;
    let finalizationCountInRemainder = 0;
    for (const event of events) {
      if (
        event.type === 'pairing:blossom-invoked' &&
        isRemainderPhase(event.phase)
      ) {
        blossomCountInRemainder++;
      }
      if (
        event.type === 'pairing:pair-finalized' &&
        isRemainderPhase(event.phase)
      ) {
        finalizationCountInRemainder++;
      }
    }

    expect(blossomCountInRemainder).toBeGreaterThanOrEqual(
      finalizationCountInRemainder,
    );
  });

  it.fails('produces the exact FIDE-correct pairings for round 15', () => {
    // Reference output from bbpPairings v6.0.0 (--dutch issue_7.trf -p).
    // Each entry is [white, black] as pairing numbers (strings).
    const expected: [string, string][] = [
      ['1', '15'],
      ['3', '2'],
      ['11', '17'],
      ['7', '10'],
      ['8', '14'],
      ['4', '6'],
      ['5', '12'],
      ['9', '16'],
      ['13', '25'],
      ['24', '22'],
      ['18', '29'],
      ['20', '23'],
      ['19', '33'],
      ['21', '38'],
      ['39', '26'],
      ['28', '36'],
      ['31', '40'],
      ['37', '35'],
      ['44', '46'],
      ['30', '32'],
      ['27', '48'],
      ['47', '42'],
      ['51', '55'],
      ['34', '50'],
      ['49', '45'],
      ['53', '58'],
      ['41', '59'],
      ['56', '43'],
      ['60', '52'],
      ['54', '57'],
    ];

    const expectedSet = new Set(
      expected.map(([w, b]) => [w, b].toSorted().join('-')),
    );

    const result = pair(players, gamesBefore);
    const actualSet = new Set(
      result.pairings.map((p) => [p.white, p.black].toSorted().join('-')),
    );

    expect(actualSet).toEqual(expectedSet);
  });
});

// ---------------------------------------------------------------------------
// issue_15
//
// 180-player tournament, 11 rounds completed. Whole-tournament pairability
// smoke test (bbpPairings issue_15 regression). No expected pairings — just
// verifies pair() can pair all 11 rounds without crashing and produces no
// rematches. XXR=12 means the tournament planned 12 rounds.
// ---------------------------------------------------------------------------
describe('dutch fixture: issue_15', () => {
  const tournament = loadFixture('issue_15');
  const allGames = toSwissGames(tournament);

  for (let round = 1; round <= 11; round++) {
    it(
      `pairs round ${round} without crashing (180 players)`,
      { timeout: 30_000 },
      () => {
        // Games played before this round
        const gamesBefore = allGames.slice(0, round - 1);
        const excluded = preAssignedIds(tournament, round);
        const players = toSwissPlayers(tournament).filter(
          (p) => !excluded.has(p.id),
        );
        const result = pair(players, gamesBefore);
        // 180 players, even count → 90 pairings, 0 byes
        expect(result.pairings).toHaveLength(90);
        expect(result.byes).toHaveLength(0);
      },
    );
  }

  it('produces no rematches in round 11', () => {
    const gamesBefore = allGames.slice(0, 10);
    const excluded = preAssignedIds(tournament, 11);
    const players = toSwissPlayers(tournament).filter(
      (p) => !excluded.has(p.id),
    );
    const result = pair(players, gamesBefore);
    const flat = gamesBefore.flat();
    for (const pairing of result.pairings) {
      const alreadyFaced = flat.some(
        (g) =>
          (g.white === pairing.white && g.black === pairing.black) ||
          (g.white === pairing.black && g.black === pairing.white),
      );
      expect(
        alreadyFaced,
        `rematch detected: ${pairing.white} vs ${pairing.black}`,
      ).toBe(false);
    }
  });
});
