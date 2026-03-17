/**
 * FIDE Dutch pairing fixture tests.
 *
 * Test cases sourced from bbpPairings (Apache 2.0):
 * https://github.com/BieremaBoyzProgramming/bbpPairings/tree/main/test/tests
 *
 * Fixture files live in @echecs/trf — imported via the local file dependency.
 *
 * NOTE: Content-assertion tests are marked .todo because the current Dutch
 * implementation uses a simplified blossom-weighted approach that does not
 * implement all 21 FIDE Dutch criteria (C.04.3). These serve as the
 * specification for a future full FIDE Dutch implementation.
 */
import parse from '@echecs/trf';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { dutch } from '../dutch.js';

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

function toSwissGames(tournament: Tournament): Game[] {
  const games: Game[] = [];
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
      games.push({
        blackId: String(result.opponentId),
        result: score,
        round: result.round,
        whiteId: String(player.pairingNumber),
      });
    }
  }
  return games;
}

/** IDs of players who have a pre-assigned Z or F bye in the target round. */
function preAssignedIds(tournament: Tournament, targetRound: number): Set<string> {
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

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'trf',
  'src',
  '__tests__',
  'fixtures',
);

function loadFixture(name: string): Tournament {
  const content = readFileSync(path.join(FIXTURES_DIR, `${name}.trf`), 'utf8');
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
  const excluded = preAssignedIds(tournament, 3);
  const players = toSwissPlayers(tournament).filter((p) => !excluded.has(p.id));
  const games = toSwissGames(tournament);

  it('excludes pre-assigned players (P4 has Z-bye)', () => {
    expect(excluded.has('4')).toBe(true);
    expect(players).toHaveLength(5);
  });

  it('produces 2 pairings and 1 bye for round 3 (5 pairable players)', () => {
    const result = dutch(players, games, 3);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(1);
  });

  it.todo(
    'produces the correct set of pairings for round 3 (requires full FIDE Dutch C5 impl): 1 vs 5, 3 vs 2, bye to 6',
  );
});

// ---------------------------------------------------------------------------
// dutch_2025_C9
// ---------------------------------------------------------------------------
describe('dutch fixture: dutch_2025_C9', () => {
  const tournament = loadFixture('dutch_2025_C9');
  const excluded = preAssignedIds(tournament, 3);
  const players = toSwissPlayers(tournament).filter((p) => !excluded.has(p.id));
  const games = toSwissGames(tournament);

  it('has no pre-assigned players for round 3', () => {
    expect(excluded.size).toBe(0);
    expect(players).toHaveLength(5);
  });

  it('produces 2 pairings and 1 bye for round 3 (5 pairable players)', () => {
    const result = dutch(players, games, 3);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(1);
  });

  it.todo(
    'produces the correct set of pairings for round 3 (requires full FIDE Dutch C9 impl): 2 vs 1, 3 vs 5, bye to 4',
  );
});

// ---------------------------------------------------------------------------
// issue_7
// ---------------------------------------------------------------------------
describe('dutch fixture: issue_7', () => {
  const tournament = loadFixture('issue_7');
  const excluded = preAssignedIds(tournament, 15);
  const players = toSwissPlayers(tournament).filter((p) => !excluded.has(p.id));
  const games = toSwissGames(tournament);

  // Expected pairings (from bbpPairings output, for the .todo test below):
  // 1-15, 3-2, 11-17, 7-10, 8-14, 4-6, 5-12, 9-16, 13-25, 24-22,
  // 18-29, 20-23, 19-33, 21-38, 39-26, 28-36, 31-40, 37-35, 44-46, 30-32,
  // 27-48, 47-42, 51-55, 34-50, 49-45, 53-58, 41-59, 56-43, 60-52, 54-57

  it('produces 30 pairings and no byes for round 15', () => {
    const result = dutch(players, games, 15);
    expect(result.pairings).toHaveLength(30);
    expect(result.byes).toHaveLength(0);
  });

  it('produces no rematches in round 15', () => {
    const result = dutch(players, games, 15);
    for (const pairing of result.pairings) {
      const alreadyFaced = games.some(
        (g) =>
          (g.whiteId === pairing.whiteId && g.blackId === pairing.blackId) ||
          (g.whiteId === pairing.blackId && g.blackId === pairing.whiteId),
      );
      expect(
        alreadyFaced,
        `rematch detected: ${pairing.whiteId} vs ${pairing.blackId}`,
      ).toBe(false);
    }
  });

  it.todo(
    'produces the exact FIDE-correct pairings for round 15 (requires full Dutch criteria impl)',
  );
});

// ---------------------------------------------------------------------------
// issue_15
//
// 180-player tournament, 11 rounds completed. Whole-tournament pairability
// smoke test (bbpPairings issue_15 regression). No expected pairings — just
// verifies dutch() can pair all 11 rounds without crashing and produces no
// rematches. XXR=12 means the tournament planned 12 rounds.
// ---------------------------------------------------------------------------
describe('dutch fixture: issue_15', () => {
  const tournament = loadFixture('issue_15');
  const allGames = toSwissGames(tournament);

  for (let round = 1; round <= 11; round++) {
    it(`pairs round ${round} without crashing (180 players)`, () => {
      // Games played before this round
      const gamesBefore = allGames.filter((g) => g.round < round);
      const excluded = preAssignedIds(tournament, round);
      const players = toSwissPlayers(tournament).filter(
        (p) => !excluded.has(p.id),
      );
      const result = dutch(players, gamesBefore, round);
      // 180 players, even count → 90 pairings, 0 byes
      expect(result.pairings).toHaveLength(90);
      expect(result.byes).toHaveLength(0);
    });
  }

  it('produces no rematches in round 11', () => {
    const gamesBefore = allGames.filter((g) => g.round < 11);
    const excluded = preAssignedIds(tournament, 11);
    const players = toSwissPlayers(tournament).filter(
      (p) => !excluded.has(p.id),
    );
    const result = dutch(players, gamesBefore, 11);
    for (const pairing of result.pairings) {
      const alreadyFaced = gamesBefore.some(
        (g) =>
          (g.whiteId === pairing.whiteId && g.blackId === pairing.blackId) ||
          (g.whiteId === pairing.blackId && g.blackId === pairing.whiteId),
      );
      expect(
        alreadyFaced,
        `rematch detected: ${pairing.whiteId} vs ${pairing.blackId}`,
      ).toBe(false);
    }
  });
});
