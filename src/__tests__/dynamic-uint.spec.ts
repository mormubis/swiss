import { describe, expect, it } from 'vitest';

import { DynamicUint } from '../dynamic-uint.js';

describe('DynamicUint', () => {
  describe('gt', () => {
    it('returns true when this > other', () => {
      expect(DynamicUint.from(10).gt(DynamicUint.from(5))).toBe(true);
    });
    it('returns false when this < other', () => {
      expect(DynamicUint.from(5).gt(DynamicUint.from(10))).toBe(false);
    });
    it('returns false when equal', () => {
      const a = DynamicUint.from(7);
      expect(a.gt(a.clone())).toBe(false);
    });
  });

  describe('lt', () => {
    it('returns true when this < other', () => {
      expect(DynamicUint.from(3).lt(DynamicUint.from(7))).toBe(true);
    });
    it('returns false when this > other', () => {
      expect(DynamicUint.from(7).lt(DynamicUint.from(3))).toBe(false);
    });
    it('returns false when equal', () => {
      const a = DynamicUint.from(7);
      expect(a.lt(a.clone())).toBe(false);
    });
  });

  describe('copyFrom', () => {
    it('copies value in-place', () => {
      const a = DynamicUint.from(42);
      const b = DynamicUint.from(99);
      a.copyFrom(b);
      expect(a.toBigInt()).toBe(99n);
    });
    it('produces an independent copy', () => {
      const a = DynamicUint.from(42);
      const b = DynamicUint.from(99);
      a.copyFrom(b);
      b.add(1);
      expect(a.toBigInt()).toBe(99n);
    });
    it('handles different word sizes', () => {
      const small = DynamicUint.from(1);
      const big = DynamicUint.from(1);
      big.shiftGrow(64); // force multi-word
      small.copyFrom(big);
      expect(small.toBigInt()).toBe(big.toBigInt());
    });
  });
});
