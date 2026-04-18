/**
 * Unit tests for the weighted blossom matching algorithm.
 * Test cases from mwmatching.py by Joris van Rantwijk.
 */
import { describe, expect, it } from 'vitest';

import { maxWeightMatching } from '../blossom.js';
import { DynamicUint } from '../dynamic-uint.js';

function edges(
  ...raw: [number, number, number][]
): [number, number, DynamicUint][] {
  return raw.map(([u, v, w]) => [u, v, DynamicUint.from(w)]);
}

describe('maxWeightMatching', () => {
  it('handles empty input', () => {
    expect(maxWeightMatching([])).toEqual([]);
  });

  it('handles single edge', () => {
    expect(maxWeightMatching(edges([0, 1, 1]))).toEqual([1, 0]);
  });

  it('test12', () => {
    expect(maxWeightMatching(edges([1, 2, 10], [2, 3, 11]))).toEqual([
      -1, -1, 3, 2,
    ]);
  });

  it('test13', () => {
    expect(maxWeightMatching(edges([1, 2, 5], [2, 3, 11], [3, 4, 5]))).toEqual([
      -1, -1, 3, 2, -1,
    ]);
  });

  it('test14 maxcardinality', () => {
    expect(
      maxWeightMatching(edges([1, 2, 5], [2, 3, 11], [3, 4, 5]), true),
    ).toEqual([-1, 2, 1, 4, 3]);
  });

  // test16 (negative weights) is omitted: DynamicUint is unsigned and cannot
  // represent negative edge weights. In practice, chess pairing weights are
  // always non-negative so this case does not arise.

  it('test20 S-blossom', () => {
    expect(
      maxWeightMatching(edges([1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7])),
    ).toEqual([-1, 2, 1, 4, 3]);
  });

  it('test20 S-blossom augmentation', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 8],
          [1, 3, 9],
          [2, 3, 10],
          [3, 4, 7],
          [1, 6, 5],
          [4, 5, 6],
        ),
      ),
    ).toEqual([-1, 6, 3, 2, 5, 4, 1]);
  });

  it('test21 T-blossom', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 9],
          [1, 3, 8],
          [2, 3, 10],
          [1, 4, 5],
          [4, 5, 4],
          [1, 6, 3],
        ),
      ),
    ).toEqual([-1, 6, 3, 2, 5, 4, 1]);
  });

  it('test21 T-blossom variant b', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 9],
          [1, 3, 8],
          [2, 3, 10],
          [1, 4, 5],
          [4, 5, 3],
          [1, 6, 4],
        ),
      ),
    ).toEqual([-1, 6, 3, 2, 5, 4, 1]);
  });

  it('test21 T-blossom variant c', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 9],
          [1, 3, 8],
          [2, 3, 10],
          [1, 4, 5],
          [4, 5, 3],
          [3, 6, 4],
        ),
      ),
    ).toEqual([-1, 2, 1, 6, 5, 4, 3]);
  });

  it('test22 nested S-blossom', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 9],
          [1, 3, 9],
          [2, 3, 10],
          [2, 4, 8],
          [3, 5, 8],
          [4, 5, 10],
          [5, 6, 6],
        ),
      ),
    ).toEqual([-1, 3, 4, 1, 2, 6, 5]);
  });

  it('test23 S-relabel nested', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 10],
          [1, 7, 10],
          [2, 3, 12],
          [3, 4, 20],
          [3, 5, 20],
          [4, 5, 25],
          [5, 6, 10],
          [6, 7, 10],
          [7, 8, 8],
        ),
      ),
    ).toEqual([-1, 2, 1, 4, 3, 6, 5, 8, 7]);
  });

  it('test24 nested S-blossom expand', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 8],
          [1, 3, 8],
          [2, 3, 10],
          [2, 4, 12],
          [3, 5, 12],
          [4, 5, 14],
          [4, 6, 12],
          [5, 7, 12],
          [6, 7, 14],
          [7, 8, 12],
        ),
      ),
    ).toEqual([-1, 2, 1, 5, 6, 3, 4, 8, 7]);
  });

  it('test25 S-T expand', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 23],
          [1, 5, 22],
          [1, 6, 15],
          [2, 3, 25],
          [3, 4, 22],
          [4, 5, 25],
          [4, 8, 14],
          [5, 7, 13],
        ),
      ),
    ).toEqual([-1, 6, 3, 2, 8, 7, 1, 5, 4]);
  });

  it('test26 nested S-T expand', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 19],
          [1, 3, 20],
          [1, 8, 8],
          [2, 3, 25],
          [2, 4, 18],
          [3, 5, 18],
          [4, 5, 13],
          [4, 7, 7],
          [5, 6, 7],
        ),
      ),
    ).toEqual([-1, 8, 3, 2, 7, 6, 5, 4, 1]);
  });

  it('test30 T-nasty expand', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 45],
          [1, 5, 45],
          [2, 3, 50],
          [3, 4, 45],
          [4, 5, 50],
          [1, 6, 30],
          [3, 9, 35],
          [4, 8, 35],
          [5, 7, 26],
          [9, 10, 5],
        ),
      ),
    ).toEqual([-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]);
  });

  it('test31 T-nasty2 expand', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 45],
          [1, 5, 45],
          [2, 3, 50],
          [3, 4, 45],
          [4, 5, 50],
          [1, 6, 30],
          [3, 9, 35],
          [4, 8, 26],
          [5, 7, 40],
          [9, 10, 5],
        ),
      ),
    ).toEqual([-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]);
  });

  it('test32 T-expand least slack', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 45],
          [1, 5, 45],
          [2, 3, 50],
          [3, 4, 45],
          [4, 5, 50],
          [1, 6, 30],
          [3, 9, 35],
          [4, 8, 28],
          [5, 7, 26],
          [9, 10, 5],
        ),
      ),
    ).toEqual([-1, 6, 3, 2, 8, 7, 1, 5, 4, 10, 9]);
  });

  it('test33 nested T-nasty expand', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 45],
          [1, 7, 45],
          [2, 3, 50],
          [3, 4, 45],
          [4, 5, 95],
          [4, 6, 94],
          [5, 6, 94],
          [6, 7, 50],
          [1, 8, 30],
          [3, 11, 35],
          [5, 9, 36],
          [7, 10, 26],
          [11, 12, 5],
        ),
      ),
    ).toEqual([-1, 8, 3, 2, 6, 9, 4, 10, 1, 5, 7, 12, 11]);
  });

  it('test34 nested S-relabel expand', () => {
    expect(
      maxWeightMatching(
        edges(
          [1, 2, 40],
          [1, 3, 40],
          [2, 3, 60],
          [2, 4, 55],
          [3, 5, 55],
          [4, 5, 50],
          [1, 8, 15],
          [5, 7, 30],
          [7, 6, 10],
          [8, 10, 10],
          [4, 9, 30],
        ),
      ),
    ).toEqual([-1, 2, 1, 5, 9, 3, 7, 6, 10, 4, 8]);
  });
});
