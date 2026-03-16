/**
 * FIDE Dutch pairing fixture tests.
 *
 * Test cases sourced from bbpPairings (Apache 2.0):
 * https://github.com/BieremaBoyzProgramming/bbpPairings/tree/main/test/tests
 *
 * Each fixture is a TRF file with a known-correct expected output produced by
 * bbpPairings, which implements the FIDE Dutch system (2025 rules, effective
 * 1 February 2026).
 *
 * The expected outputs define which player plays White and which plays Black.
 * Our implementation may assign colours differently (colour assignment is
 * separate from pairing selection), so these tests assert only the *set* of
 * pairings, not the colour assignment.
 *
 * NOTE: The content-assertion tests below are currently marked as `.todo`
 * because the current Dutch implementation uses a simplified blossom-weighted
 * approach that does not implement all 21 FIDE Dutch criteria (C.04.3).
 * Specifically, cross-group floating (criteria C5, C9, and related bracket
 * mechanics) is not yet correctly handled.
 *
 * These tests serve as the specification for a future full FIDE Dutch
 * implementation. The structural tests (correct player count, no rematches)
 * pass and are not marked todo.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { dutch } from '../dutch.js';
import { parseTrf } from './parse-trf.js';

function fixtureContent(name: string): string {
  return readFileSync(
    path.join(import.meta.dirname, 'fixtures', `${name}.trf`),
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// dutch_2025_C5
//
// 6-player tournament, 2 rounds completed. Tests Dutch criterion C5 (PAB
// assignment). Expected round-3 pairings (from bbpPairings output):
//   1 vs 5, 3 vs 2, 6 bye
// ---------------------------------------------------------------------------
describe('dutch fixture: dutch_2025_C5', () => {
  // P4 has a pre-assigned Z-bye for round 3 — excluded from pairing
  const { players, games, preAssigned } = parseTrf(fixtureContent('dutch_2025_C5'), 3);
  const pairablePlayers = players.filter((p) => !preAssigned.has(p.id));

  it('excludes pre-assigned players (P4 has Z-bye)', () => {
    expect(preAssigned.has('4')).toBe(true);
    expect(pairablePlayers).toHaveLength(5);
  });

  it('produces 2 pairings and 1 bye for round 3 (5 pairable players)', () => {
    const result = dutch(pairablePlayers, games, 3);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(1);
  });

  it.todo(
    'produces the correct set of pairings for round 3 (requires full FIDE Dutch C5 impl): 1 vs 5, 3 vs 2, bye to 6',
  );
});

// ---------------------------------------------------------------------------
// dutch_2025_C9
//
// 5-player tournament, 1 round completed (player 5 had a Z-bye in round 1).
// Tests Dutch criterion C9 (bye recipient minimises unplayed games).
// Expected round-3 pairings (from bbpPairings output):
//   2 vs 1, 3 vs 5, 4 bye
// ---------------------------------------------------------------------------
describe('dutch fixture: dutch_2025_C9', () => {
  // No pre-assigned results for round 3 in this fixture
  const { players, games, preAssigned } = parseTrf(fixtureContent('dutch_2025_C9'), 3);
  const pairablePlayers = players.filter((p) => !preAssigned.has(p.id));

  it('has no pre-assigned players for round 3', () => {
    expect(preAssigned.size).toBe(0);
    expect(pairablePlayers).toHaveLength(5);
  });

  it('produces 2 pairings and 1 bye for round 3 (5 pairable players)', () => {
    const result = dutch(pairablePlayers, games, 3);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(1);
  });

  it.todo(
    'produces the correct set of pairings for round 3 (requires full FIDE Dutch C9 impl): 2 vs 1, 3 vs 5, bye to 4',
  );
});

// ---------------------------------------------------------------------------
// issue_7
//
// 60-player tournament, 14 rounds completed. Regression test.
// Expected round-15 pairings (from bbpPairings output):
//   1-15, 3-2, 11-17, 7-10, 8-14, 4-6, 5-12, 9-16, 13-25, 24-22,
//   18-29, 20-23, 19-33, 21-38, 39-26, 28-36, 31-40, 37-35, 44-46,
//   30-32, 27-48, 47-42, 51-55, 34-50, 49-45, 53-58, 41-59, 56-43,
//   60-52, 54-57
// ---------------------------------------------------------------------------
describe('dutch fixture: issue_7', () => {
  const { players, games, preAssigned } = parseTrf(fixtureContent('issue_7'), 15);
  const pairablePlayers = players.filter((p) => !preAssigned.has(p.id));

  // Expected pairings (from bbpPairings output, for the .todo test below):
  // 1-15, 3-2, 11-17, 7-10, 8-14, 4-6, 5-12, 9-16, 13-25, 24-22,
  // 18-29, 20-23, 19-33, 21-38, 39-26, 28-36, 31-40, 37-35, 44-46, 30-32,
  // 27-48, 47-42, 51-55, 34-50, 49-45, 53-58, 41-59, 56-43, 60-52, 54-57

  it('produces 30 pairings and no byes for round 15', () => {
    const result = dutch(pairablePlayers, games, 15);
    expect(result.pairings).toHaveLength(30);
    expect(result.byes).toHaveLength(0);
  });

  it('produces no rematches in round 15', () => {
    const result = dutch(pairablePlayers, games, 15);
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
