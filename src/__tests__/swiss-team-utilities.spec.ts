import { describe, expect, it } from 'vitest';

import { typeAColorPreference } from '../utilities.js';

import type { Game } from '../types.js';

describe('typeAColorPreference', () => {
  it('returns undefined when no games played', () => {
    expect(typeAColorPreference('A', [])).toBeUndefined();
  });

  it("returns 'white' when CD < -1 (0 whites, 3 blacks → CD = -3)", () => {
    // 3 black games → whites=0, blacks=3, CD = 0-3 = -3
    const games: Game[] = [
      { blackId: 'A', result: 0, round: 1, whiteId: 'B' },
      { blackId: 'A', result: 1, round: 2, whiteId: 'B' },
      { blackId: 'A', result: 0.5, round: 3, whiteId: 'B' },
    ];
    expect(typeAColorPreference('A', games)).toBe('white');
  });

  it("returns 'white' when CD is 0 and last two matches were black", () => {
    // History: white, black, black, white, black, black → whites=3, blacks=3, CD=0, last two=black,black
    const games: Game[] = [
      { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 2, whiteId: 'B' },
      { blackId: 'A', result: 0, round: 3, whiteId: 'B' },
      { blackId: 'B', result: 1, round: 4, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 5, whiteId: 'B' },
      { blackId: 'A', result: 0, round: 6, whiteId: 'B' },
    ];
    expect(typeAColorPreference('A', games)).toBe('white');
  });

  it("returns 'white' when CD is -1 and last two matches were black", () => {
    // History: white, black, black, black → whites=1, blacks=3, CD=-2... too much
    // Need CD=-1: whites=1, blacks=2, CD=-1, last two=black,black
    const games: Game[] = [
      { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 2, whiteId: 'B' },
      { blackId: 'A', result: 0, round: 3, whiteId: 'B' },
    ];
    // whites=1, blacks=2, CD = 1-2 = -1, last two = [black, black]
    expect(typeAColorPreference('A', games)).toBe('white');
  });

  it("returns 'black' when CD > +1 (3 whites, 0 blacks → CD = +3)", () => {
    // 3 white games → whites=3, blacks=0, CD = 3-0 = 3
    const games: Game[] = [
      { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'B', result: 0, round: 2, whiteId: 'A' },
      { blackId: 'B', result: 0.5, round: 3, whiteId: 'A' },
    ];
    expect(typeAColorPreference('A', games)).toBe('black');
  });

  it("returns 'black' when CD is 0 and last two matches were white", () => {
    // History: black, white, white, black, white, white → whites=4, blacks=2, no...
    // Need CD=0 with last two white: whites=3, blacks=3, last two=white,white
    const games: Game[] = [
      { blackId: 'A', result: 0, round: 1, whiteId: 'B' },
      { blackId: 'B', result: 1, round: 2, whiteId: 'A' },
      { blackId: 'B', result: 1, round: 3, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 4, whiteId: 'B' },
      { blackId: 'B', result: 1, round: 5, whiteId: 'A' },
      { blackId: 'B', result: 1, round: 6, whiteId: 'A' },
    ];
    expect(typeAColorPreference('A', games)).toBe('black');
  });

  it("returns 'black' when CD is +1 and last two matches were white", () => {
    // whites=2, blacks=1, CD=1, last two=white,white
    const games: Game[] = [
      { blackId: 'A', result: 0, round: 1, whiteId: 'B' },
      { blackId: 'B', result: 1, round: 2, whiteId: 'A' },
      { blackId: 'B', result: 1, round: 3, whiteId: 'A' },
    ];
    // whites=2, blacks=1, CD=2-1=1, last two=[white,white]
    expect(typeAColorPreference('A', games)).toBe('black');
  });

  it('returns undefined when CD is 0 and last two differ', () => {
    // whites=2, blacks=2, CD=0, last two=[white,black] or [black,white]
    const games: Game[] = [
      { blackId: 'B', result: 1, round: 1, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 2, whiteId: 'B' },
      { blackId: 'B', result: 1, round: 3, whiteId: 'A' },
      { blackId: 'A', result: 0, round: 4, whiteId: 'B' },
    ];
    // history: white, black, white, black → CD=0, last two=[white,black]
    expect(typeAColorPreference('A', games)).toBeUndefined();
  });
});
