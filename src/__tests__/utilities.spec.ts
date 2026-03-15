import { describe, expect, it } from 'vitest';

import {
  byeScore,
  colorHistory,
  colorPreference,
  gamesForPlayer,
  score,
  scoreGroups,
} from '../utilities.js';

import type { Game, Player } from '../types.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

const GAMES: Game[] = [
  { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
  { blackId: 'D', result: 0, round: 1, whiteId: 'C' },
  { blackId: 'A', result: 0.5, round: 2, whiteId: 'C' },
  { blackId: 'B', result: 0, round: 2, whiteId: 'D' },
];

describe('gamesForPlayer', () => {
  it('returns all games for a given player', () => {
    const result = gamesForPlayer('A', GAMES);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when player has no games', () => {
    expect(gamesForPlayer('A', [])).toEqual([]);
  });
});

describe('score', () => {
  it('sums wins, draws, and losses correctly', () => {
    // A: won round 1 as white (1), drew round 2 as black (0.5) = 1.5
    expect(score('A', GAMES)).toBe(1.5);
  });

  it('returns 0 for player with no games', () => {
    expect(score('A', [])).toBe(0);
  });
});

describe('byeScore', () => {
  it('returns 0 when player has received no bye', () => {
    expect(byeScore('A', [])).toBe(0);
  });

  it('returns 1 when player has received one bye', () => {
    const gamesWithBye: Game[] = [
      { blackId: '', result: 1, round: 1, whiteId: 'A' },
    ];
    expect(byeScore('A', gamesWithBye)).toBe(1);
  });
});

describe('colorHistory', () => {
  it('returns array of colors played each round', () => {
    // A played white in round 1, black in round 2
    expect(colorHistory('A', GAMES)).toEqual(['white', 'black']);
  });
});

describe('colorPreference', () => {
  it('returns white preference when player has played more black', () => {
    // A: 1 white, 1 black → no preference (difference = 0)
    expect(colorPreference('A', GAMES)).toBe(0);
  });

  it('returns positive when player prefers white', () => {
    // B: 2 black games → prefers white (diff = +2)
    expect(colorPreference('B', GAMES)).toBe(2);
  });
});

describe('scoreGroups', () => {
  it('groups players by their score', () => {
    const groups = scoreGroups(PLAYERS, GAMES);
    // After round 2: A=1.5, B=1, C=0.5, D=1
    expect(groups.get(1.5)).toHaveLength(1);
    expect(groups.get(1)).toHaveLength(2);
    expect(groups.get(0.5)).toHaveLength(1);
  });
});
