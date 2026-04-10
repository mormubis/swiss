import { describe, expect, it } from 'vitest';

import {
  byeScore,
  colorHistory,
  colorPreference,
  floatHistory,
  gamesForPlayer,
  isTopscorer,
  score,
  scoreGroups,
  unplayedRounds,
} from '../utilities.js';

import type { FloatKind, Game, Player } from '../types.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

// Round 1: A(w) 1-0 B, C(w) 0-1 D
// Round 2: C(w) 0.5-0.5 A, D(w) 0-1 B  (blackId:A = black, so A is black; B wins as black)
const GAMES: Game[][] = [
  [
    { black: 'B', result: 1, white: 'A' },
    { black: 'D', result: 0, white: 'C' },
  ],
  [
    { black: 'A', result: 0.5, white: 'C' },
    { black: 'B', result: 0, white: 'D' },
  ],
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
    const gamesWithBye: Game[][] = [[{ black: 'A', result: 1, white: 'A' }]];
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

describe('isTopscorer', () => {
  it('returns true when score exceeds half total rounds', () => {
    // 3 rounds, score 2 → 2 > 3/2 = 1.5 → true
    expect(isTopscorer(2, 3)).toBe(true);
  });

  it('returns false when score equals half total rounds', () => {
    // 4 rounds, score 2 → 2 > 4/2 = 2 → false (not strictly greater)
    expect(isTopscorer(2, 4)).toBe(false);
  });

  it('returns false when score is below half total rounds', () => {
    // 4 rounds, score 1 → 1 > 2 → false
    expect(isTopscorer(1, 4)).toBe(false);
  });

  it('returns true for fractional comparison', () => {
    // 5 rounds, score 3 → 3 > 5/2 = 2.5 → true
    expect(isTopscorer(3, 5)).toBe(true);
  });
});

describe('unplayedRounds', () => {
  it('returns 0 when player has played every round', () => {
    // A played in both rounds
    expect(unplayedRounds('A', GAMES)).toBe(0);
  });

  it('returns the count of rounds with no game entry', () => {
    const gamesWithMissing: Game[][] = [
      [{ black: 'B', result: 1, white: 'A' }],
      // Round 2: A has no game at all
      [{ black: 'D', result: 0, white: 'C' }],
    ];
    expect(unplayedRounds('A', gamesWithMissing)).toBe(1);
  });

  it('does not count bye rounds as unplayed', () => {
    const gamesWithBye: Game[][] = [
      [{ black: 'A', result: 1, white: 'A' }], // bye
    ];
    expect(unplayedRounds('A', gamesWithBye)).toBe(0);
  });

  it('returns 0 for empty games', () => {
    expect(unplayedRounds('A', [])).toBe(0);
  });
});

describe('floatHistory', () => {
  it('returns undefined for each round where player had no game', () => {
    const gamesWithMissing: Game[][] = [
      [{ black: 'B', result: 1, white: 'A' }],
      [{ black: 'D', result: 0, white: 'C' }], // A absent
    ];
    const result: FloatKind[] = floatHistory('A', gamesWithMissing);
    expect(result[1]).toBeUndefined();
  });

  it('returns "down" for bye rounds', () => {
    const gamesWithBye: Game[][] = [
      [{ black: 'A', result: 1, white: 'A' }], // bye sentinel
    ];
    const result: FloatKind[] = floatHistory('A', gamesWithBye);
    expect(result[0]).toBe('down');
  });

  it('returns "down" when player has higher score than opponent', () => {
    // After round 1: A has 1, B has 0. In round 2: C(w) 0.5-0.5 A, D(w) 0-1 B
    // For A in round 2: previous scores (games[0]) → A=1, C=0. A > C → 'down'
    const result: FloatKind[] = floatHistory('A', GAMES);
    expect(result[1]).toBe('down');
  });

  it('returns "up" when player has lower score than opponent', () => {
    // For C in round 2: previous scores (games[0]) → C=0, A=1. C < A → 'up'
    const result: FloatKind[] = floatHistory('C', GAMES);
    expect(result[1]).toBe('up');
  });

  it('returns undefined when player and opponent have equal scores', () => {
    // Round 1: A=0 (before any games), C=0. Equal → undefined
    const result: FloatKind[] = floatHistory('A', GAMES);
    expect(result[0]).toBeUndefined();
  });

  it('returns an array with one entry per round', () => {
    const result: FloatKind[] = floatHistory('A', GAMES);
    expect(result).toHaveLength(2);
  });
});
