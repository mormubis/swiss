import { describe, expect, it } from 'vitest';

import { DynamicUint } from '../dynamic-uint.js';
import { buildEdgeWeight, computeMaxWeight } from '../weights.js';

import type { PlayerState } from '../utilities.js';
import type { BracketContext, Criterion } from '../weights.js';

function makeState(overrides: Partial<PlayerState>): PlayerState {
  return {
    byeCount: 0,
    colorDiff: 0,
    colorHistory: [],
    floatHistory: [],
    id: 'X',
    opponents: new Set<string>(),
    preferenceStrength: 'none',
    preferredColor: undefined,
    score: 0,
    tpn: 1,
    unplayedRounds: 0,
    ...overrides,
  };
}

const defaultContext: BracketContext = {
  byeAssigneeScore: 0,
  isSingleDownfloaterTheByeAssignee: false,
  scoreGroupSizeBits: 4,
  scoreGroupShifts: new Map(),
  scoreGroupsShift: 8,
  tournament: { expectedRounds: 9, playedRounds: 3 },
};

describe('buildEdgeWeight', () => {
  it('returns zero for players who have faced each other (C1)', () => {
    const a = makeState({ id: 'A', opponents: new Set(['B']) });
    const b = makeState({ id: 'B' });

    const weight = buildEdgeWeight([], a, b, defaultContext);
    expect(weight.isZero()).toBe(true);
  });

  it('encodes a single criterion value correctly', () => {
    const a = makeState({ id: 'A' });
    const b = makeState({ id: 'B' });

    const criterion: Criterion = {
      bits: 8,
      evaluate: () => 42,
    };

    const weight = buildEdgeWeight([criterion], a, b, defaultContext);
    const expected = DynamicUint.from(42);
    expect(weight.compareTo(expected)).toBe(0);
  });

  it('places higher-priority criterion in higher bits', () => {
    const a = makeState({ id: 'A' });
    const b = makeState({ id: 'B' });

    const criteria: Criterion[] = [
      { bits: 8, evaluate: () => 1 },
      { bits: 8, evaluate: () => 0 },
    ];

    const criteriaFlipped: Criterion[] = [
      { bits: 8, evaluate: () => 0 },
      { bits: 8, evaluate: () => 255 },
    ];

    const weightHigh = buildEdgeWeight(criteria, a, b, defaultContext);
    const weightLow = buildEdgeWeight(criteriaFlipped, a, b, defaultContext);

    // criterion[0] value 1 in high bits > criterion[1] value 255 in low bits
    expect(weightHigh.compareTo(weightLow)).toBe(1);
  });

  it('resolves dynamic bits from context', () => {
    const a = makeState({ id: 'A' });
    const b = makeState({ id: 'B' });

    const context: BracketContext = {
      ...defaultContext,
      scoreGroupSizeBits: 6,
    };

    const criterion: Criterion = {
      bits: (c) => c.scoreGroupSizeBits,
      evaluate: () => 7,
    };

    const weight = buildEdgeWeight([criterion], a, b, context);
    const expected = DynamicUint.from(7);
    expect(weight.compareTo(expected)).toBe(0);
  });

  it('packs multiple criteria correctly', () => {
    const a = makeState({ id: 'A' });
    const b = makeState({ id: 'B' });

    // 3 criteria each 4 bits: values 1, 2, 3
    // layout: [c0(4bits)][c1(4bits)][c2(4bits)]
    // = 1 << 8 | 2 << 4 | 3 = 256 + 32 + 3 = 291
    const criteria: Criterion[] = [
      { bits: 4, evaluate: () => 1 },
      { bits: 4, evaluate: () => 2 },
      { bits: 4, evaluate: () => 3 },
    ];

    const weight = buildEdgeWeight(criteria, a, b, defaultContext);
    const expected = DynamicUint.from((1 << 8) | (2 << 4) | 3);
    expect(weight.compareTo(expected)).toBe(0);
  });

  it('handles criterion that evaluates to 0 without corrupting weight', () => {
    const a = makeState({ id: 'A' });
    const b = makeState({ id: 'B' });

    const criteria: Criterion[] = [
      { bits: 8, evaluate: () => 5 },
      { bits: 8, evaluate: () => 0 },
    ];

    const weight = buildEdgeWeight(criteria, a, b, defaultContext);
    // 5 << 8 | 0 = 1280
    const expected = DynamicUint.from(5 << 8);
    expect(weight.compareTo(expected)).toBe(0);
  });
});

describe('computeMaxWeight', () => {
  it('returns max value for single criterion', () => {
    const criterion: Criterion = { bits: 4, evaluate: () => 0 };
    const max = computeMaxWeight([criterion], defaultContext);
    const expected = DynamicUint.from((1 << 4) - 1);
    expect(max.compareTo(expected)).toBe(0);
  });

  it('returns value greater than any possible edge weight', () => {
    const a = makeState({ id: 'A' });
    const b = makeState({ id: 'B' });

    const criteria: Criterion[] = [
      { bits: 8, evaluate: () => 200 },
      { bits: 8, evaluate: () => 200 },
    ];

    const weight = buildEdgeWeight(criteria, a, b, defaultContext);
    const max = computeMaxWeight(criteria, defaultContext);

    expect(max.compareTo(weight)).toBe(1);
  });

  it('handles dynamic bits in context', () => {
    const context: BracketContext = { ...defaultContext, scoreGroupsShift: 10 };
    const criterion: Criterion = {
      bits: (c) => c.scoreGroupsShift,
      evaluate: () => 0,
    };

    const max = computeMaxWeight([criterion], context);
    const expected = DynamicUint.from((1 << 10) - 1);
    expect(max.compareTo(expected)).toBe(0);
  });

  it('packs multiple criteria into correct max', () => {
    const criteria: Criterion[] = [
      { bits: 4, evaluate: () => 0 },
      { bits: 4, evaluate: () => 0 },
    ];

    const max = computeMaxWeight(criteria, defaultContext);
    // 0xF << 4 | 0xF = 0xFF
    const expected = DynamicUint.from(0xff);
    expect(max.compareTo(expected)).toBe(0);
  });
});
