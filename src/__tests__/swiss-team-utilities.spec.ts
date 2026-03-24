import { describe, expect, it } from 'vitest';

import { typeAColorPreference } from '../utilities.js';

import type { Game } from '../types.js';

describe('typeAColorPreference', () => {
  it('returns undefined when no games played', () => {
    expect(typeAColorPreference('A', [])).toBeUndefined();
  });

  it("returns 'white' when CD < -1 (0 whites, 3 blacks → CD = -3)", () => {
    // 3 black games → whites=0, blacks=3, CD = 0-3 = -3
    const games: Game[][] = [
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'A', result: 1, whiteId: 'B' }],
      [{ blackId: 'A', result: 0.5, whiteId: 'B' }],
    ];
    expect(typeAColorPreference('A', games)).toBe('white');
  });

  it("returns 'white' when CD is 0 and last two matches were black", () => {
    // History: white, black, black, white, black, black → whites=3, blacks=3, CD=0, last two=black,black
    const games: Game[][] = [
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
    ];
    expect(typeAColorPreference('A', games)).toBe('white');
  });

  it("returns 'white' when CD is -1 and last two matches were black", () => {
    // whites=1, blacks=2, CD=-1, last two=black,black
    const games: Game[][] = [
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
    ];
    expect(typeAColorPreference('A', games)).toBe('white');
  });

  it("returns 'black' when CD > +1 (3 whites, 0 blacks → CD = +3)", () => {
    // 3 white games → whites=3, blacks=0, CD = 3-0 = 3
    const games: Game[][] = [
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'B', result: 0, whiteId: 'A' }],
      [{ blackId: 'B', result: 0.5, whiteId: 'A' }],
    ];
    expect(typeAColorPreference('A', games)).toBe('black');
  });

  it("returns 'black' when CD is 0 and last two matches were white", () => {
    // whites=3, blacks=3, last two=white,white
    const games: Game[][] = [
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
    ];
    expect(typeAColorPreference('A', games)).toBe('black');
  });

  it("returns 'black' when CD is +1 and last two matches were white", () => {
    // whites=2, blacks=1, CD=1, last two=white,white
    const games: Game[][] = [
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
    ];
    expect(typeAColorPreference('A', games)).toBe('black');
  });

  it('returns undefined when CD is 0 and last two differ', () => {
    // whites=2, blacks=2, CD=0, last two=[white,black]
    const games: Game[][] = [
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
      [{ blackId: 'B', result: 1, whiteId: 'A' }],
      [{ blackId: 'A', result: 0, whiteId: 'B' }],
    ];
    // history: white, black, white, black → CD=0, last two=[white,black]
    expect(typeAColorPreference('A', games)).toBeUndefined();
  });
});
