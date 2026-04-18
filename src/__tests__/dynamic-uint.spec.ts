import { describe, expect, it } from 'vitest';

import { DynamicUint } from '../dynamic-uint.js';

describe('DynamicUint', () => {
  describe('construction', () => {
    it('zero() creates a zero value with specified word count', () => {
      const n = DynamicUint.zero(2);
      expect(n.words).toBe(2);
      expect(n.isZero()).toBe(true);
    });

    it('from(0) creates a zero with 1 word', () => {
      const n = DynamicUint.from(0);
      expect(n.words).toBe(1);
      expect(n.isZero()).toBe(true);
    });

    it('from(42) creates a single-word value', () => {
      const n = DynamicUint.from(42);
      expect(n.words).toBe(1);
      expect(n.isZero()).toBe(false);
    });

    it('from(0x1_0000_0000) creates a two-word value', () => {
      // 2^32 doesn't fit in a single 32-bit word
      const n = DynamicUint.from(0x1_00_00_00_00);
      expect(n.words).toBe(2);
      expect(n.isZero()).toBe(false);
    });

    it('from(Number.MAX_SAFE_INTEGER) creates a two-word value', () => {
      const n = DynamicUint.from(Number.MAX_SAFE_INTEGER);
      expect(n.words).toBe(2);
      expect(n.isZero()).toBe(false);
    });
  });

  describe('compareTo', () => {
    it('returns 0 for equal values', () => {
      const a = DynamicUint.from(42);
      const b = DynamicUint.from(42);
      expect(a.compareTo(b)).toBe(0);
    });

    it('returns -1 when less than', () => {
      const a = DynamicUint.from(10);
      const b = DynamicUint.from(20);
      expect(a.compareTo(b)).toBe(-1);
    });

    it('returns 1 when greater than', () => {
      const a = DynamicUint.from(20);
      const b = DynamicUint.from(10);
      expect(a.compareTo(b)).toBe(1);
    });

    it('compares multi-word values correctly', () => {
      const a = DynamicUint.from(0x1_00_00_00_00); // 2^32
      const b = DynamicUint.from(0xff_ff_ff_ff); // 2^32 - 1
      expect(a.compareTo(b)).toBe(1);
      expect(b.compareTo(a)).toBe(-1);
    });

    it('compares same-value multi-word correctly', () => {
      const a = DynamicUint.from(0x1_00_00_00_01);
      const b = DynamicUint.from(0x1_00_00_00_01);
      expect(a.compareTo(b)).toBe(0);
    });

    it('handles different word counts (zero padded)', () => {
      const a = DynamicUint.zero(2);
      const b = DynamicUint.zero(1);
      // both are zero
      expect(a.compareTo(b)).toBe(0);
    });
  });

  describe('clone', () => {
    it('returns an independent copy', () => {
      const a = DynamicUint.from(42);
      const b = a.clone();
      expect(a.compareTo(b)).toBe(0);
      // mutate original, clone should be unaffected
      a.add(1);
      expect(b.compareTo(DynamicUint.from(42))).toBe(0);
    });

    it('clone has same word count', () => {
      const a = DynamicUint.zero(3);
      const b = a.clone();
      expect(b.words).toBe(3);
    });
  });

  describe('isZero', () => {
    it('returns true for zero()', () => {
      expect(DynamicUint.zero(2).isZero()).toBe(true);
    });

    it('returns true for from(0)', () => {
      expect(DynamicUint.from(0).isZero()).toBe(true);
    });

    it('returns false for non-zero', () => {
      expect(DynamicUint.from(1).isZero()).toBe(false);
    });

    it('returns false after adding to zero', () => {
      const n = DynamicUint.zero(1);
      n.add(5);
      expect(n.isZero()).toBe(false);
    });
  });

  describe('or(number)', () => {
    it('sets bits in the lowest word', () => {
      const n = DynamicUint.zero(2);
      n.or(0b1010);
      // should be non-zero
      expect(n.isZero()).toBe(false);
    });

    it('combines bits with OR correctly', () => {
      const a = DynamicUint.from(0b0101);
      a.or(0b1010);
      const expected = DynamicUint.from(0b1111);
      expect(a.compareTo(expected)).toBe(0);
    });

    it('does not affect high words', () => {
      const n = DynamicUint.zero(2);
      n.or(0xff_ff_ff_ff); // all bits in lowest word
      // high word still zero; value equals 0xffffffff
      const expected = DynamicUint.from(0xff_ff_ff_ff);
      expect(n.compareTo(expected)).toBe(0);
    });

    it('returns this for chaining', () => {
      const n = DynamicUint.zero(1);
      expect(n.or(1)).toBe(n);
    });
  });

  describe('or(DynamicUint)', () => {
    it('ORs all words', () => {
      const a = DynamicUint.from(0x1_00_00_00_00); // word1=1, word0=0
      const b = DynamicUint.from(0xff_ff_ff_ff); // word1=0, word0=0xffffffff
      a.or(b);
      // result should have word1=1 and word0=0xffffffff
      const expected = DynamicUint.from(0x1_ff_ff_ff_ff);
      expect(a.compareTo(expected)).toBe(0);
    });

    it('returns this for chaining', () => {
      const a = DynamicUint.zero(2);
      const b = DynamicUint.zero(2);
      expect(a.or(b)).toBe(a);
    });
  });

  describe('and(number)', () => {
    it('masks the lowest word', () => {
      const n = DynamicUint.from(0b1111);
      n.and(0b0110);
      const expected = DynamicUint.from(0b0110);
      expect(n.compareTo(expected)).toBe(0);
    });

    it('clears all high words', () => {
      const n = DynamicUint.from(0x1_ff_ff_ff_ff); // 2 words
      n.and(0xff_ff_ff_ff);
      // upper word should be zeroed; result = lower 32 bits of 0xffffffff
      const expected = DynamicUint.from(0xff_ff_ff_ff);
      // n now has 2 words but upper word is 0; compare should still work
      expect(n.compareTo(expected)).toBe(0);
    });

    it('returns this for chaining', () => {
      const n = DynamicUint.from(7);
      expect(n.and(3)).toBe(n);
    });
  });

  describe('shiftLeft', () => {
    it('shifts within a single word', () => {
      const n = DynamicUint.from(1);
      n.shiftLeft(4);
      expect(n.compareTo(DynamicUint.from(16))).toBe(0);
    });

    it('shifts across word boundary', () => {
      // 1 << 32 = 0x1_0000_0000
      const n = DynamicUint.zero(2);
      n.or(1);
      n.shiftLeft(32);
      const expected = DynamicUint.from(0x1_00_00_00_00);
      expect(n.compareTo(expected)).toBe(0);
    });

    it('shifts by exact 32', () => {
      const n = DynamicUint.zero(2);
      n.or(3);
      n.shiftLeft(32);
      // 3 << 32 = 0x3_0000_0000
      const expected = DynamicUint.from(0x3_00_00_00_00);
      expect(n.compareTo(expected)).toBe(0);
    });

    it('returns this for chaining', () => {
      const n = DynamicUint.from(1);
      expect(n.shiftLeft(1)).toBe(n);
    });
  });

  describe('shiftRight', () => {
    it('shifts within a single word', () => {
      const n = DynamicUint.from(16);
      n.shiftRight(4);
      expect(n.compareTo(DynamicUint.from(1))).toBe(0);
    });

    it('shifts across word boundary', () => {
      // 0x1_0000_0000 >> 32 = 1
      const n = DynamicUint.from(0x1_00_00_00_00);
      n.shiftRight(32);
      expect(n.compareTo(DynamicUint.from(1))).toBe(0);
    });

    it('shifts away all bits to zero', () => {
      const n = DynamicUint.from(1);
      n.shiftRight(1);
      expect(n.isZero()).toBe(true);
    });

    it('returns this for chaining', () => {
      const n = DynamicUint.from(4);
      expect(n.shiftRight(1)).toBe(n);
    });
  });

  describe('shiftGrow', () => {
    it('fits without growing when result stays in bounds', () => {
      const n = DynamicUint.from(1);
      const wordsBefore = n.words;
      n.shiftGrow(4);
      expect(n.words).toBe(wordsBefore);
      expect(n.compareTo(DynamicUint.from(16))).toBe(0);
    });

    it('grows by 1 word when needed', () => {
      const n = DynamicUint.zero(1);
      n.or(1);
      // shifting 1 left by 32 bits needs 2 words
      n.shiftGrow(32);
      expect(n.words).toBeGreaterThanOrEqual(2);
      expect(n.compareTo(DynamicUint.from(0x1_00_00_00_00))).toBe(0);
    });

    it('grows by multiple words when needed', () => {
      const n = DynamicUint.zero(1);
      n.or(1);
      // shifting 1 left by 64 bits needs 3 words
      n.shiftGrow(64);
      expect(n.words).toBeGreaterThanOrEqual(3);
    });

    it('handles zero value correctly', () => {
      const n = DynamicUint.zero(1);
      n.shiftGrow(100);
      expect(n.isZero()).toBe(true);
    });

    it('returns this for chaining', () => {
      const n = DynamicUint.from(1);
      expect(n.shiftGrow(1)).toBe(n);
    });
  });

  describe('add(number)', () => {
    it('adds a simple value', () => {
      const n = DynamicUint.from(10);
      n.add(5);
      expect(n.compareTo(DynamicUint.from(15))).toBe(0);
    });

    it('handles carry across word boundary', () => {
      // 0xffff_ffff + 1 = 0x1_0000_0000
      const n = DynamicUint.zero(2);
      n.or(0xff_ff_ff_ff);
      n.add(1);
      const expected = DynamicUint.from(0x1_00_00_00_00);
      expect(n.compareTo(expected)).toBe(0);
    });

    it('returns this for chaining', () => {
      const n = DynamicUint.from(1);
      expect(n.add(1)).toBe(n);
    });
  });

  describe('add(DynamicUint)', () => {
    it('adds two multi-word values', () => {
      const a = DynamicUint.from(0x1_00_00_00_00); // 2^32
      const b = DynamicUint.from(0x1_00_00_00_00); // 2^32
      a.add(b);
      const expected = DynamicUint.from(0x2_00_00_00_00);
      expect(a.compareTo(expected)).toBe(0);
    });

    it('handles carry from lower word to upper word', () => {
      const a = DynamicUint.zero(2);
      a.or(0xff_ff_ff_ff);
      const b = DynamicUint.from(1);
      a.add(b);
      const expected = DynamicUint.from(0x1_00_00_00_00);
      expect(a.compareTo(expected)).toBe(0);
    });

    it('returns this for chaining', () => {
      const a = DynamicUint.zero(2);
      const b = DynamicUint.zero(2);
      expect(a.add(b)).toBe(a);
    });
  });

  describe('subtract(number)', () => {
    it('subtracts a simple value', () => {
      const n = DynamicUint.from(10);
      n.subtract(3);
      expect(n.compareTo(DynamicUint.from(7))).toBe(0);
    });

    it('handles borrow across word boundary', () => {
      // 0x1_0000_0000 - 1 = 0xffff_ffff
      const n = DynamicUint.from(0x1_00_00_00_00);
      n.subtract(1);
      const expected = DynamicUint.from(0xff_ff_ff_ff);
      expect(n.compareTo(expected)).toBe(0);
    });

    it('returns this for chaining', () => {
      const n = DynamicUint.from(5);
      expect(n.subtract(1)).toBe(n);
    });
  });

  describe('subtract(DynamicUint)', () => {
    it('subtracts multi-word values', () => {
      const a = DynamicUint.from(0x2_00_00_00_00);
      const b = DynamicUint.from(0x1_00_00_00_00);
      a.subtract(b);
      const expected = DynamicUint.from(0x1_00_00_00_00);
      expect(a.compareTo(expected)).toBe(0);
    });

    it('handles borrow from upper word', () => {
      const a = DynamicUint.from(0x1_00_00_00_00);
      const b = DynamicUint.from(1);
      a.subtract(b);
      const expected = DynamicUint.from(0xff_ff_ff_ff);
      expect(a.compareTo(expected)).toBe(0);
    });

    it('returns this for chaining', () => {
      const a = DynamicUint.from(10);
      const b = DynamicUint.from(5);
      expect(a.subtract(b)).toBe(a);
    });
  });
});
