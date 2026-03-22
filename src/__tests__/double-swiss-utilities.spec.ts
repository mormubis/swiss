import { describe, expect, it } from 'vitest';

import { matchColorHistory, matchCount } from '../utilities.js';

import type { Game } from '../types.js';

describe('matchCount', () => {
  it('returns 0 when player has no games', () => {
    expect(matchCount('A', [])).toBe(0);
  });

  it('counts each unique real-opponent round as one match', () => {
    const games: Game[] = [
      { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 1, whiteId: 'B' },
      { blackId: 'A', result: 1, round: 2, whiteId: 'B' },
      { blackId: 'B', result: 0, round: 2, whiteId: 'A' },
    ];
    expect(matchCount('A', games)).toBe(2);
  });

  it('does not count bye rounds', () => {
    const games: Game[] = [{ blackId: '', result: 1, round: 1, whiteId: 'A' }];
    expect(matchCount('A', games)).toBe(0);
  });

  it('does not count bye rounds even when mixed with real games', () => {
    const games: Game[] = [
      { blackId: '', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'B', result: 1, round: 2, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 2, whiteId: 'B' },
    ];
    expect(matchCount('A', games)).toBe(1);
  });
});

describe('matchColorHistory', () => {
  it('returns empty array when player has no games', () => {
    expect(matchColorHistory('A', [])).toEqual([]);
  });

  it('returns the color of the first game in each match round', () => {
    const games: Game[] = [
      // Round 1: A plays white first (game 1), then black (game 2) — first game determines color
      { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 1, whiteId: 'B' },
      // Round 2: A plays black first (lower whiteId is B), so color is black
      { blackId: 'A', result: 1, round: 2, whiteId: 'B' },
      { blackId: 'B', result: 0, round: 2, whiteId: 'A' },
    ];
    const result = matchColorHistory('A', games);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('white'); // first game round 1: A is white
    expect(result[1]).toBe('black'); // first game round 2: A is black
  });

  it('skips bye rounds', () => {
    const games: Game[] = [
      { blackId: '', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'B', result: 1, round: 2, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 2, whiteId: 'B' },
    ];
    const result = matchColorHistory('A', games);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('white');
  });

  it('returns colors sorted by round ascending', () => {
    const games: Game[] = [
      { blackId: 'A', result: 1, round: 2, whiteId: 'B' },
      { blackId: 'B', result: 0, round: 2, whiteId: 'A' },
      { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 1, whiteId: 'B' },
    ];
    const result = matchColorHistory('A', games);
    expect(result).toEqual(['white', 'black']); // round 1: white, round 2: black
  });
});
