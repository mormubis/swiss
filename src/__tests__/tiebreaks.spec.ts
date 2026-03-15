import { describe, expect, it } from 'vitest';

import {
  buchholz,
  buchholzCut,
  directEncounter,
  medianBuchholz,
  progressive,
  sonnebornBerger,
} from '../tiebreaks.js';

import type { Game, Player } from '../types.js';

// 4 players, 3 rounds:
// Round 1: A(W) 1-0 B, C(W) 0-1 D
// Round 2: A(W) 0.5-0.5 D, C(W) 0-1 B
// Round 3: A(W) 1-0 C, D(W) 1-0 B
// Scores: A=2.5, D=2.5, B=1, C=0
const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

const GAMES: Game[] = [
  { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
  { blackId: 'D', result: 0, round: 1, whiteId: 'C' },
  { blackId: 'D', result: 0.5, round: 2, whiteId: 'A' },
  { blackId: 'B', result: 0, round: 2, whiteId: 'C' },
  { blackId: 'C', result: 1, round: 3, whiteId: 'A' },
  { blackId: 'B', result: 1, round: 3, whiteId: 'D' },
];

describe('buchholz', () => {
  it("returns sum of all opponents' scores", () => {
    // A played B(1), D(2.5), C(0) → Buchholz = 3.5
    expect(buchholz('A', PLAYERS, GAMES)).toBe(3.5);
  });
});

describe('buchholzCut', () => {
  it('returns Buchholz minus the lowest opponent score', () => {
    // A: opponents B(1), D(2.5), C(0) → cut lowest (0) → 3.5
    expect(buchholzCut('A', PLAYERS, GAMES)).toBe(3.5);
  });
});

describe('medianBuchholz', () => {
  it('returns Buchholz minus lowest and highest opponent scores', () => {
    // A: opponents B(1), D(2.5), C(0) → remove 0 and 2.5 → 1
    expect(medianBuchholz('A', PLAYERS, GAMES)).toBe(1);
  });
});

describe('sonnebornBerger', () => {
  it('returns sum of scores of defeated opponents plus half score of drawn opponents', () => {
    // A: beat B(1)→1×1=1, drew D(2.5)→0.5×2.5=1.25, beat C(0)→1×0=0 → total=2.25
    expect(sonnebornBerger('A', PLAYERS, GAMES)).toBe(2.25);
  });
});

describe('progressive', () => {
  it('returns sum of cumulative scores after each round', () => {
    // A: after r1=1, after r2=1.5, after r3=2.5 → sum=5
    expect(progressive('A', PLAYERS, GAMES)).toBe(5);
  });
});

describe('directEncounter', () => {
  it('returns the score in games between tied players', () => {
    // A and D are tied at 2.5; A drew D → 0.5
    expect(directEncounter('A', PLAYERS, GAMES)).toBe(0.5);
  });
});
