# Swiss Pairing Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `@echecs/swiss` pairing engine from scratch using weighted
blossom matching for the four main systems (Dutch, Dubov, Burstein, Lim) and
cleaned-up lexicographic enumeration for Double-Swiss and Swiss Team.

**Architecture:** Each pairing system encodes FIDE criteria as edge weights in
an arbitrary-precision integer (`DynamicUint`), then runs Edmonds' blossom
algorithm to find the optimal matching in O(n^3). Per-system differences
(ranking, criteria, color allocation, bye tiebreaks) are expressed as
configuration arrays consumed by shared infrastructure. Double-Swiss and Swiss
Team use lexicographic enumeration with simpler criteria.

**Tech Stack:** TypeScript (strict, ESM-only), Vitest for tests, tsdown for
bundling. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-04-18-swiss-pairing-rewrite-design.md`

**FIDE references (local):**

- `docs/C0401.md` -- basic rules
- `docs/C0403.md` -- Dutch system
- `docs/C040401.md` -- Dubov system
- `docs/C040402.md` -- Burstein system

**FIDE references (remote -- no local doc):**

- Lim: https://handbook.fide.com/chapter/C040403202602
- Double-Swiss: https://handbook.fide.com/chapter/DoubleSwissSystem202602
- Swiss Team: https://handbook.fide.com/chapter/SwissTeamPairingSystem202602

---

## File Structure

```
src/
  types.ts                  # Keep as-is (public types)
  dynamic-uint.ts           # NEW: DynamicUint class
  blossom.ts                # REWRITE: Edmonds' blossom with DynamicUint
  utilities.ts              # REWRITE: PlayerState, shared logic
  weights.ts                # NEW: data-driven weight builder
  dutch.ts                  # REWRITE: Dutch system
  dubov.ts                  # REWRITE: Dubov system
  burstein.ts               # REWRITE: Burstein system
  lim.ts                    # REWRITE: Lim system
  lexicographic.ts          # REWRITE: shared lexicographic matching
  double-swiss.ts           # REWRITE: Double-Swiss system
  swiss-team.ts             # REWRITE: Swiss Team system
  dutch-entry.ts            # Keep (thin re-export)
  dubov-entry.ts            # Keep
  burstein-entry.ts         # Keep
  lim-entry.ts              # Keep
  double-entry.ts           # Keep
  team-entry.ts             # Keep
  index.ts                  # Keep

src/__tests__/
  dynamic-uint.spec.ts      # NEW
  blossom.spec.ts           # REWRITE
  utilities.spec.ts         # REWRITE
  weights.spec.ts           # NEW
  dutch.spec.ts             # REWRITE
  dutch.fixtures.spec.ts    # Keep (fixture-based integration tests)
  dubov.spec.ts             # REWRITE
  burstein.spec.ts          # REWRITE
  lim.spec.ts               # REWRITE
  double-swiss.spec.ts      # REWRITE
  swiss-team.spec.ts        # REWRITE
```

---

## Task 1: DynamicUint

**Files:**

- Create: `src/dynamic-uint.ts`
- Create: `src/__tests__/dynamic-uint.spec.ts`

This is the foundation -- all weight encoding and blossom arithmetic depends on
it.

- [ ] **Step 1: Write failing tests for construction and basic ops**

```ts
// src/__tests__/dynamic-uint.spec.ts
import { describe, expect, it } from 'vitest';

import { DynamicUint } from '../dynamic-uint.js';

describe('DynamicUint', () => {
  describe('construction', () => {
    it('creates a zero with specified word count', () => {
      const n = DynamicUint.zero(2);
      expect(n.isZero()).toBe(true);
      expect(n.words).toBe(2);
    });

    it('creates from a small number', () => {
      const n = DynamicUint.from(42);
      expect(n.isZero()).toBe(false);
      expect(n.compareTo(DynamicUint.from(42))).toBe(0);
    });

    it('creates from zero', () => {
      const n = DynamicUint.from(0);
      expect(n.isZero()).toBe(true);
    });
  });

  describe('compareTo', () => {
    it('returns 0 for equal values', () => {
      expect(DynamicUint.from(100).compareTo(DynamicUint.from(100))).toBe(0);
    });

    it('returns -1 when this < other', () => {
      expect(DynamicUint.from(5).compareTo(DynamicUint.from(10))).toBe(-1);
    });

    it('returns 1 when this > other', () => {
      expect(DynamicUint.from(10).compareTo(DynamicUint.from(5))).toBe(1);
    });

    it('compares multi-word values correctly', () => {
      const a = DynamicUint.from(1).shiftLeft(40).or(0xff);
      const b = DynamicUint.from(2).shiftLeft(40).or(0x00);
      expect(a.compareTo(b)).toBe(-1);
    });
  });

  describe('clone', () => {
    it('produces an independent copy', () => {
      const a = DynamicUint.from(42);
      const b = a.clone();
      b.add(1);
      expect(a.compareTo(DynamicUint.from(42))).toBe(0);
      expect(b.compareTo(DynamicUint.from(43))).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/dynamic-uint.spec.ts` Expected: FAIL -- module
`../dynamic-uint.js` not found.

- [ ] **Step 3: Implement DynamicUint construction, compareTo, isZero, clone**

```ts
// src/dynamic-uint.ts

/**
 * Mutable arbitrary-precision unsigned integer backed by Uint32Array.
 * Little-endian word order (word 0 = least significant).
 *
 * Only supports operations needed for edge weight encoding and blossom
 * matching: shift, or, and, add, subtract, compare.
 *
 * @internal Not part of the public API.
 */
class DynamicUint {
  #data: Uint32Array;

  private constructor(data: Uint32Array) {
    this.#data = data;
  }

  static zero(words: number): DynamicUint {
    return new DynamicUint(new Uint32Array(words));
  }

  static from(value: number): DynamicUint {
    if (value === 0) {
      return new DynamicUint(new Uint32Array(1));
    }
    // Handle values that need more than one 32-bit word.
    const lo = value >>> 0;
    const hi = Math.floor(value / 0x1_0000_0000) >>> 0;
    if (hi === 0) {
      const data = new Uint32Array(1);
      data[0] = lo;
      return new DynamicUint(data);
    }
    const data = new Uint32Array(2);
    data[0] = lo;
    data[1] = hi;
    return new DynamicUint(data);
  }

  get words(): number {
    return this.#data.length;
  }

  isZero(): boolean {
    for (let i = 0; i < this.#data.length; i++) {
      if (this.#data[i] !== 0) return false;
    }
    return true;
  }

  compareTo(other: DynamicUint): -1 | 0 | 1 {
    const maxLen = Math.max(this.#data.length, other.#data.length);
    for (let i = maxLen - 1; i >= 0; i--) {
      const a = i < this.#data.length ? this.#data[i]! : 0;
      const b = i < other.#data.length ? other.#data[i]! : 0;
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }

  clone(): DynamicUint {
    return new DynamicUint(new Uint32Array(this.#data));
  }
}

export { DynamicUint };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/dynamic-uint.spec.ts` Expected: PASS

- [ ] **Step 5: Write failing tests for bitwise ops (or, and, shiftLeft)**

```ts
// Add to src/__tests__/dynamic-uint.spec.ts

describe('or', () => {
  it('ORs a small number into the lowest word', () => {
    const n = DynamicUint.zero(1);
    n.or(0xff);
    expect(n.compareTo(DynamicUint.from(0xff))).toBe(0);
  });

  it('ORs two DynamicUints together', () => {
    const a = DynamicUint.from(0xf0);
    const b = DynamicUint.from(0x0f);
    a.or(b);
    expect(a.compareTo(DynamicUint.from(0xff))).toBe(0);
  });
});

describe('and', () => {
  it('masks with a small number', () => {
    const n = DynamicUint.from(0xff);
    n.and(0x0f);
    expect(n.compareTo(DynamicUint.from(0x0f))).toBe(0);
  });

  it('clears high words when ANDing with small number', () => {
    const n = DynamicUint.from(1).shiftLeft(40).or(0xff);
    n.and(0x0f);
    expect(n.compareTo(DynamicUint.from(0x0f))).toBe(0);
  });
});

describe('shiftLeft', () => {
  it('shifts within a single word', () => {
    const n = DynamicUint.from(1);
    n.shiftLeft(8);
    expect(n.compareTo(DynamicUint.from(256))).toBe(0);
  });

  it('shifts across word boundaries', () => {
    const n = DynamicUint.zero(3);
    n.or(1);
    n.shiftLeft(33);
    // 1 << 33 = 0x2_0000_0000
    const expected = DynamicUint.from(0x2_0000_0000);
    expect(n.compareTo(expected)).toBe(0);
  });

  it('shifts by exact word size (32)', () => {
    const n = DynamicUint.zero(2);
    n.or(0xabcd);
    n.shiftLeft(32);
    // Low word should be 0, high word should be 0xabcd.
    const expected = DynamicUint.from(0xabcd * 0x1_0000_0000);
    expect(n.compareTo(expected)).toBe(0);
  });
});
```

- [ ] **Step 6: Implement or, and, shiftLeft**

Add to `src/dynamic-uint.ts`:

```ts
or(value: number | DynamicUint): this {
  if (typeof value === 'number') {
    this.#data[0]! |= value >>> 0;
    return this;
  }
  const other = value;
  for (let i = 0; i < Math.min(this.#data.length, other.#data.length); i++) {
    this.#data[i]! |= other.#data[i]!;
  }
  return this;
}

and(value: number | DynamicUint): this {
  if (typeof value === 'number') {
    if (this.#data.length > 0) {
      this.#data[0]! &= value >>> 0;
    }
    for (let i = 1; i < this.#data.length; i++) {
      this.#data[i] = 0;
    }
    return this;
  }
  const other = value;
  for (let i = 0; i < this.#data.length; i++) {
    this.#data[i]! &= i < other.#data.length ? other.#data[i]! : 0;
  }
  return this;
}

shiftLeft(bits: number): this {
  if (bits === 0) return this;
  const wordShift = (bits >>> 5); // bits / 32
  const bitShift = bits & 31;    // bits % 32

  for (let i = this.#data.length - 1; i >= 0; i--) {
    let value = 0;
    const src = i - wordShift;
    if (src >= 0) {
      value = this.#data[src]! << bitShift;
      if (bitShift > 0 && src - 1 >= 0) {
        value |= this.#data[src - 1]! >>> (32 - bitShift);
      }
    }
    this.#data[i] = value >>> 0;
  }
  return this;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test src/__tests__/dynamic-uint.spec.ts` Expected: PASS

- [ ] **Step 8: Write failing tests for shiftRight, shiftGrow**

```ts
// Add to src/__tests__/dynamic-uint.spec.ts

describe('shiftRight', () => {
  it('shifts within a single word', () => {
    const n = DynamicUint.from(256);
    n.shiftRight(4);
    expect(n.compareTo(DynamicUint.from(16))).toBe(0);
  });

  it('shifts across word boundaries', () => {
    const n = DynamicUint.from(0x2_0000_0000);
    n.shiftRight(1);
    expect(n.compareTo(DynamicUint.from(0x1_0000_0000))).toBe(0);
  });
});

describe('shiftGrow', () => {
  it('grows storage when shift would overflow', () => {
    const n = DynamicUint.from(1);
    expect(n.words).toBe(1);
    n.shiftGrow(32);
    expect(n.words).toBe(2);
    // Value should be 1 << 32 = 0x1_0000_0000
    expect(n.compareTo(DynamicUint.from(0x1_0000_0000))).toBe(0);
  });

  it('does not grow when shift fits', () => {
    const n = DynamicUint.from(1);
    n.shiftGrow(4);
    expect(n.words).toBe(1);
    expect(n.compareTo(DynamicUint.from(16))).toBe(0);
  });

  it('handles large shifts requiring multiple new words', () => {
    const n = DynamicUint.from(1);
    n.shiftGrow(96);
    expect(n.words).toBeGreaterThanOrEqual(4);
    expect(n.isZero()).toBe(false);
  });
});
```

- [ ] **Step 9: Implement shiftRight, shiftGrow**

Add to `src/dynamic-uint.ts`:

```ts
shiftRight(bits: number): this {
  if (bits === 0) return this;
  const wordShift = (bits >>> 5);
  const bitShift = bits & 31;

  for (let i = 0; i < this.#data.length; i++) {
    const src = i + wordShift;
    let value = 0;
    if (src < this.#data.length) {
      value = this.#data[src]! >>> bitShift;
      if (bitShift > 0 && src + 1 < this.#data.length) {
        value |= this.#data[src + 1]! << (32 - bitShift);
      }
    }
    this.#data[i] = value >>> 0;
  }
  return this;
}

shiftGrow(bits: number): this {
  if (bits === 0) return this;

  // Find the highest set bit position.
  let highestBit = -1;
  for (let i = this.#data.length - 1; i >= 0; i--) {
    if (this.#data[i] !== 0) {
      highestBit = i * 32 + (31 - Math.clz32(this.#data[i]!));
      break;
    }
  }

  if (highestBit < 0) {
    // Value is zero -- just shift (no-op on zero).
    return this.shiftLeft(bits);
  }

  const neededBits = highestBit + 1 + bits;
  const neededWords = Math.ceil(neededBits / 32);

  if (neededWords > this.#data.length) {
    const newData = new Uint32Array(neededWords);
    newData.set(this.#data);
    this.#data = newData;
  }

  return this.shiftLeft(bits);
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm test src/__tests__/dynamic-uint.spec.ts` Expected: PASS

- [ ] **Step 11: Write failing tests for add, subtract**

```ts
// Add to src/__tests__/dynamic-uint.spec.ts

describe('add', () => {
  it('adds a small number', () => {
    const n = DynamicUint.from(10);
    n.add(5);
    expect(n.compareTo(DynamicUint.from(15))).toBe(0);
  });

  it('carries across word boundaries', () => {
    const n = DynamicUint.from(0xffff_ffff);
    n.add(1);
    expect(n.compareTo(DynamicUint.from(0x1_0000_0000))).toBe(0);
  });

  it('adds two DynamicUints', () => {
    const a = DynamicUint.from(0x1_0000_0000);
    const b = DynamicUint.from(0x1_0000_0000);
    a.add(b);
    expect(a.compareTo(DynamicUint.from(0x2_0000_0000))).toBe(0);
  });

  it('adds zero without changing value', () => {
    const n = DynamicUint.from(42);
    n.add(0);
    expect(n.compareTo(DynamicUint.from(42))).toBe(0);
  });
});

describe('subtract', () => {
  it('subtracts a small number', () => {
    const n = DynamicUint.from(15);
    n.subtract(5);
    expect(n.compareTo(DynamicUint.from(10))).toBe(0);
  });

  it('borrows across word boundaries', () => {
    const n = DynamicUint.from(0x1_0000_0000);
    n.subtract(1);
    expect(n.compareTo(DynamicUint.from(0xffff_ffff))).toBe(0);
  });

  it('subtracts two DynamicUints', () => {
    const a = DynamicUint.from(0x2_0000_0000);
    const b = DynamicUint.from(0x1_0000_0000);
    a.subtract(b);
    expect(a.compareTo(DynamicUint.from(0x1_0000_0000))).toBe(0);
  });

  it('results in zero when subtracting equal values', () => {
    const n = DynamicUint.from(42);
    n.subtract(42);
    expect(n.isZero()).toBe(true);
  });
});
```

- [ ] **Step 12: Implement add, subtract**

Add to `src/dynamic-uint.ts`:

```ts
add(value: number | DynamicUint): this {
  if (typeof value === 'number') {
    let carry = value >>> 0;
    for (let i = 0; i < this.#data.length && carry !== 0; i++) {
      const sum = this.#data[i]! + carry;
      this.#data[i] = sum >>> 0;
      carry = sum > 0xffff_ffff ? 1 : 0;
    }
    return this;
  }
  const other = value;
  let carry = 0;
  for (let i = 0; i < this.#data.length; i++) {
    const a = this.#data[i]!;
    const b = i < other.#data.length ? other.#data[i]! : 0;
    const sum = a + b + carry;
    this.#data[i] = sum >>> 0;
    // Detect carry: if sum overflowed 32 bits.
    carry = (a > 0xffff_ffff - b) || (carry > 0 && a + b === 0xffff_ffff)
      ? 1 : 0;
  }
  return this;
}

subtract(value: number | DynamicUint): this {
  if (typeof value === 'number') {
    let borrow = value >>> 0;
    for (let i = 0; i < this.#data.length && borrow !== 0; i++) {
      const current = this.#data[i]!;
      this.#data[i] = (current - borrow) >>> 0;
      borrow = current < borrow ? 1 : 0;
    }
    return this;
  }
  const other = value;
  let borrow = 0;
  for (let i = 0; i < this.#data.length; i++) {
    const a = this.#data[i]!;
    const b = (i < other.#data.length ? other.#data[i]! : 0) + borrow;
    this.#data[i] = (a - b) >>> 0;
    borrow = a < b ? 1 : 0;
  }
  return this;
}
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `pnpm test src/__tests__/dynamic-uint.spec.ts` Expected: PASS

- [ ] **Step 14: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 15: Commit**

```bash
git add src/dynamic-uint.ts src/__tests__/dynamic-uint.spec.ts
git commit -m "feat: add DynamicUint arbitrary-precision unsigned integer"
```

---

## Task 2: Blossom Algorithm Rewrite

**Files:**

- Rewrite: `src/blossom.ts`
- Rewrite: `src/__tests__/blossom.spec.ts`

Rewrite the blossom algorithm to use `DynamicUint` instead of `number | bigint`.
The algorithm itself (Edmonds' blossom with augmenting paths, blossom
contraction/expansion, dual variable updates) stays the same. The arithmetic
changes from native operators to `DynamicUint` methods.

- [ ] **Step 1: Write failing tests**

Rewrite `src/__tests__/blossom.spec.ts` using the same test cases from
mwmatching.py but with `DynamicUint` weights. The test helper converts number
edges to DynamicUint edges.

```ts
// src/__tests__/blossom.spec.ts
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

  it('chooses higher-weight edge', () => {
    expect(maxWeightMatching(edges([1, 2, 10], [2, 3, 11]))).toEqual([
      -1, -1, 3, 2,
    ]);
  });

  it('max cardinality mode prefers more pairs', () => {
    expect(
      maxWeightMatching(edges([1, 2, 5], [2, 3, 11], [3, 4, 5]), true),
    ).toEqual([-1, 2, 1, 4, 3]);
  });

  it('handles S-blossom', () => {
    expect(
      maxWeightMatching(edges([1, 2, 8], [1, 3, 9], [2, 3, 10], [3, 4, 7])),
    ).toEqual([-1, 2, 1, 4, 3]);
  });

  it('handles S-blossom augmentation', () => {
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

  it('handles T-blossom', () => {
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

  it('handles nested S-blossom', () => {
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

  it('handles S-relabel nested', () => {
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

  it('handles nested S-blossom expand', () => {
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

  it('handles T-nasty expand', () => {
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/blossom.spec.ts` Expected: FAIL -- the current
`maxWeightMatching` accepts `[number, number, Weight][]` with
`Weight = number | bigint`, not `DynamicUint`.

- [ ] **Step 3: Rewrite blossom.ts to use DynamicUint**

Rewrite `src/blossom.ts`. The algorithm is the same Edmonds' blossom from
mwmatching.py. Replace all generic `Weight` type usage with `DynamicUint`.
Replace arithmetic operators with `DynamicUint` methods:

- `a + b` → `a.clone().add(b)`
- `a - b` → `a.clone().subtract(b)`
- `a < b` → `a.compareTo(b) < 0`
- `a <= b` → `a.compareTo(b) <= 0`
- `a * 2` → `a.clone().shiftLeft(1)`
- `a / 2` → `a.clone().shiftRight(1)`
- `0` → `DynamicUint.from(0)` or a shared zero constant

Key considerations:

- Use `clone()` before mutating operations since `DynamicUint` is mutable.
- The `dualvar` arrays hold `DynamicUint` instances -- update in-place where
  possible to reduce allocations.
- `maxWeightMatching` signature changes to:
  `(edges: [number, number, DynamicUint][], maxcardinality?: boolean) => number[]`

The full implementation is ~500 lines (same structure as current blossom.ts,
different arithmetic). Do NOT change the algorithm logic -- only the type and
arithmetic calls.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/blossom.spec.ts` Expected: PASS

- [ ] **Step 5: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/blossom.ts src/__tests__/blossom.spec.ts
git commit -m "feat: rewrite blossom algorithm to use DynamicUint"
```

---

## Task 3: Utilities Rewrite

**Files:**

- Rewrite: `src/utilities.ts`
- Rewrite: `src/__tests__/utilities.spec.ts`

Rewrite utilities around the `PlayerState` precomputed struct. All per-player
data is computed once and cached.

- [ ] **Step 1: Write failing tests for buildPlayerStates**

```ts
// src/__tests__/utilities.spec.ts
import { describe, expect, it } from 'vitest';

import { buildPlayerStates, scoreGroups } from '../utilities.js';

import type { Game, Player } from '../types.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

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

describe('buildPlayerStates', () => {
  it('computes scores correctly', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const stateA = states.find((s) => s.id === 'A')!;
    const stateC = states.find((s) => s.id === 'C')!;
    expect(stateA.score).toBe(1.5);
    expect(stateC.score).toBe(0.5);
  });

  it('computes opponents set', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const stateA = states.find((s) => s.id === 'A')!;
    expect(stateA.opponents.has('B')).toBe(true);
    expect(stateA.opponents.has('C')).toBe(true);
    expect(stateA.opponents.has('D')).toBe(false);
  });

  it('computes color history', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const stateA = states.find((s) => s.id === 'A')!;
    expect(stateA.colorHistory).toEqual(['white', 'black']);
  });

  it('computes color diff', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const stateA = states.find((s) => s.id === 'A')!;
    // 1 white, 1 black → diff = 0
    expect(stateA.colorDiff).toBe(0);
  });

  it('computes TPN (1-indexed)', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const stateA = states.find((s) => s.id === 'A')!;
    const stateD = states.find((s) => s.id === 'D')!;
    expect(stateA.tpn).toBe(1);
    expect(stateD.tpn).toBe(4);
  });

  it('computes preference strength', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const stateA = states.find((s) => s.id === 'A')!;
    // colorDiff = 0, no repeated color → mild or none
    expect(stateA.preferenceStrength).toBe('none');
  });

  it('detects absolute preference from repeated same color', () => {
    const games: Game[][] = [
      [{ black: 'B', result: 1, white: 'A' }],
      [{ black: 'B', result: 1, white: 'A' }],
    ];
    const states = buildPlayerStates(PLAYERS.slice(0, 2), games);
    const stateA = states.find((s) => s.id === 'A')!;
    // A played white twice → colorDiff = 2, absolute pref for black
    expect(stateA.preferenceStrength).toBe('absolute');
    expect(stateA.preferredColor).toBe('black');
  });

  it('computes bye count', () => {
    const gamesWithBye: Game[][] = [
      [
        { black: '', result: 1, white: 'A' },
        { black: 'D', result: 1, white: 'B' },
      ],
    ];
    const states = buildPlayerStates(PLAYERS.slice(0, 3), gamesWithBye);
    const stateA = states.find((s) => s.id === 'A')!;
    expect(stateA.byeCount).toBe(1);
  });
});

describe('scoreGroups', () => {
  it('groups players by score in descending order', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const groups = scoreGroups(states);
    const scores = [...groups.keys()];
    expect(scores).toEqual([2, 1.5, 0.5, 0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/utilities.spec.ts` Expected: FAIL --
`buildPlayerStates` not exported from `../utilities.js`.

- [ ] **Step 3: Implement buildPlayerStates and scoreGroups**

Rewrite `src/utilities.ts` with the `PlayerState` interface and builder.

Key implementation details:

- `PlayerState.opponents` is a `Set<string>` built from all games where the
  player participated (excluding bye games where `black === ''`).
- `PlayerState.colorHistory` is an array of `'white' | 'black' | undefined` per
  round. `undefined` for rounds where the player didn't play a color game (bye,
  forfeit-loss).
- `PlayerState.colorDiff` = count of whites - count of blacks.
- `PlayerState.preferenceStrength`:
  - `'absolute'` if `|colorDiff| > 1` OR last two colors are the same
  - `'strong'` if `|colorDiff| === 1`
  - `'mild'` if `colorDiff === 0` and player has played at least one game
  - `'none'` if player has no color history
- `PlayerState.preferredColor`:
  - Opposite of the majority color (if `colorDiff !== 0`)
  - Opposite of the last color played (if `colorDiff === 0` and has history)
  - `undefined` if no history
- `PlayerState.floatHistory` is derived by comparing the player's score before
  each round with their opponent's score. `'down'` if player's score was higher,
  `'up'` if lower, `undefined` if same or no game.
- `PlayerState.byeCount` counts games where `black === ''` and `white === id`.
- `PlayerState.unplayedRounds` counts rounds where the player has no game at
  all.

Also implement:

- `scoreGroups(states: PlayerState[])` returns `Map<number, PlayerState[]>` with
  keys sorted descending. Each group's players are sorted by TPN ascending.
- `assignBye(states, games, tiebreak)` finds the bye assignee per FIDE basic
  rules, parameterized by a tiebreak comparator.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/utilities.spec.ts` Expected: PASS

- [ ] **Step 5: Write failing tests for assignBye**

```ts
// Add to src/__tests__/utilities.spec.ts

import { assignBye } from '../utilities.js';

describe('assignBye', () => {
  it('returns undefined when player count is even', () => {
    const states = buildPlayerStates(PLAYERS, []);
    const result = assignBye(states, [], (a, b) => a.tpn - b.tpn);
    expect(result).toBeUndefined();
  });

  it('selects lowest-score player for bye', () => {
    const players = PLAYERS.slice(0, 3);
    const states = buildPlayerStates(players, GAMES);
    const result = assignBye(states, GAMES, (a, b) => b.tpn - a.tpn);
    // Scores: A=1.5, B=2, C=0.5. Lowest is C.
    expect(result?.id).toBe('C');
  });

  it('excludes players who already had a bye', () => {
    const players: Player[] = [
      { id: 'A', rating: 2000 },
      { id: 'B', rating: 1900 },
      { id: 'C', rating: 1800 },
    ];
    const gamesWithBye: Game[][] = [
      [
        { black: '', result: 1, white: 'C' },
        { black: 'B', result: 1, white: 'A' },
      ],
    ];
    const states = buildPlayerStates(players, gamesWithBye);
    const result = assignBye(states, gamesWithBye, (a, b) => b.tpn - a.tpn);
    // C already had bye, so should be excluded. A=1, B=0. B gets bye.
    expect(result?.id).toBe('B');
  });
});
```

- [ ] **Step 6: Implement assignBye**

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test src/__tests__/utilities.spec.ts` Expected: PASS

- [ ] **Step 8: Write failing tests for color allocation engine**

```ts
// Add to src/__tests__/utilities.spec.ts

import { allocateColor } from '../utilities.js';
import type { ColorRule } from '../utilities.js';

describe('allocateColor', () => {
  it('walks rules until one returns a decision', () => {
    const states = buildPlayerStates(PLAYERS.slice(0, 2), []);
    const a = states.find((s) => s.id === 'A')!;
    const b = states.find((s) => s.id === 'B')!;

    const rules: ColorRule[] = [() => 'continue', () => 'hrp-white'];

    const result = allocateColor(a, b, rules, (x, y) => x.tpn - y.tpn);
    // A has lower TPN → A is HRP → HRP gets white → A is white
    expect(result.white).toBe('A');
    expect(result.black).toBe('B');
  });

  it('falls back to HRP-white when all rules return continue', () => {
    const states = buildPlayerStates(PLAYERS.slice(0, 2), []);
    const a = states.find((s) => s.id === 'A')!;
    const b = states.find((s) => s.id === 'B')!;

    const result = allocateColor(a, b, [], (x, y) => x.tpn - y.tpn);
    expect(result.white).toBe('A');
  });
});
```

- [ ] **Step 9: Implement allocateColor**

```ts
// Add to src/utilities.ts

type ColorRule = (
  hrp: PlayerState,
  opponent: PlayerState,
) => 'continue' | 'hrp-black' | 'hrp-white';

function allocateColor(
  a: PlayerState,
  b: PlayerState,
  rules: ColorRule[],
  rankCompare: (x: PlayerState, y: PlayerState) => number,
): { black: string; white: string } {
  // Determine HRP: higher score wins; if tied, use rankCompare.
  const isAHigher =
    a.score > b.score || (a.score === b.score && rankCompare(a, b) < 0);
  const hrp = isAHigher ? a : b;
  const opp = isAHigher ? b : a;

  for (const rule of rules) {
    const decision = rule(hrp, opp);
    if (decision === 'hrp-white') {
      return { black: opp.id, white: hrp.id };
    }
    if (decision === 'hrp-black') {
      return { black: hrp.id, white: opp.id };
    }
  }

  // Fallback: HRP gets white.
  return { black: opp.id, white: hrp.id };
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `pnpm test src/__tests__/utilities.spec.ts` Expected: PASS

- [ ] **Step 11: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/utilities.ts src/__tests__/utilities.spec.ts
git commit -m "feat: rewrite utilities with PlayerState and shared logic"
```

---

## Task 4: Weight Encoding

**Files:**

- Create: `src/weights.ts`
- Create: `src/__tests__/weights.spec.ts`

Data-driven weight builder that takes a `Criterion[]` array and produces a
`DynamicUint` edge weight.

- [ ] **Step 1: Write failing tests**

```ts
// src/__tests__/weights.spec.ts
import { describe, expect, it } from 'vitest';

import { DynamicUint } from '../dynamic-uint.js';
import { buildEdgeWeight, computeMaxWeight } from '../weights.js';

import type { BracketContext, Criterion } from '../weights.js';
import type { PlayerState } from '../utilities.js';

// Minimal PlayerState factory for testing.
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

const CTX: BracketContext = {
  byeAssigneeScore: 0,
  isSingleDownfloaterTheByeAssignee: false,
  scoreGroupSizeBits: 4,
  scoreGroupShifts: new Map([
    [0, 0],
    [1, 4],
  ]),
  scoreGroupsShift: 8,
  tournament: { expectedRounds: 9, playedRounds: 2 },
};

describe('buildEdgeWeight', () => {
  it('returns zero for incompatible players (opponents)', () => {
    const a = makeState({ id: 'A', opponents: new Set(['B']) });
    const b = makeState({ id: 'B', opponents: new Set(['A']) });

    const criteria: Criterion[] = [{ bits: 4, evaluate: () => 1 }];

    const result = buildEdgeWeight(criteria, a, b, CTX);
    expect(result.isZero()).toBe(true);
  });

  it('encodes single criterion as shifted value', () => {
    const a = makeState({ id: 'A' });
    const b = makeState({ id: 'B' });

    const criteria: Criterion[] = [{ bits: 4, evaluate: () => 5 }];

    const result = buildEdgeWeight(criteria, a, b, CTX);
    expect(result.compareTo(DynamicUint.from(5))).toBe(0);
  });

  it('higher-priority criterion dominates lower', () => {
    const a = makeState({ id: 'A' });
    const b = makeState({ id: 'B' });

    const criteriaHigh: Criterion[] = [
      { bits: 8, evaluate: () => 1 },
      { bits: 8, evaluate: () => 0 },
    ];

    const criteriaLow: Criterion[] = [
      { bits: 8, evaluate: () => 0 },
      { bits: 8, evaluate: () => 255 },
    ];

    const weightHigh = buildEdgeWeight(criteriaHigh, a, b, CTX);
    const weightLow = buildEdgeWeight(criteriaLow, a, b, CTX);
    expect(weightHigh.compareTo(weightLow)).toBe(1);
  });
});

describe('computeMaxWeight', () => {
  it('computes an upper bound on edge weight', () => {
    const criteria: Criterion[] = [
      { bits: 8, evaluate: () => 0 },
      { bits: 4, evaluate: () => 0 },
    ];
    const max = computeMaxWeight(criteria, CTX);
    // Should be at least (0xFF << 4) | 0xF = 0xFFF
    expect(max.compareTo(DynamicUint.from(0))).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/weights.spec.ts` Expected: FAIL

- [ ] **Step 3: Implement weights.ts**

```ts
// src/weights.ts
import { DynamicUint } from './dynamic-uint.js';

import type { PlayerState } from './utilities.js';

interface BracketContext {
  byeAssigneeScore: number;
  isSingleDownfloaterTheByeAssignee: boolean;
  scoreGroupSizeBits: number;
  scoreGroupShifts: Map<number, number>;
  scoreGroupsShift: number;
  tournament: { expectedRounds: number; playedRounds: number };
}

interface Criterion {
  bits: number | ((ctx: BracketContext) => number);
  evaluate: (a: PlayerState, b: PlayerState, ctx: BracketContext) => number;
}

function resolveBits(bits: Criterion['bits'], ctx: BracketContext): number {
  return typeof bits === 'function' ? bits(ctx) : bits;
}

/**
 * Build edge weight for a pair of players given a priority-ordered list of
 * criteria. First criterion in the array = highest priority (placed in the
 * most significant bits).
 *
 * Returns DynamicUint.from(0) if the players have already faced each other
 * (C1 violation).
 */
function buildEdgeWeight(
  criteria: Criterion[],
  a: PlayerState,
  b: PlayerState,
  ctx: BracketContext,
): DynamicUint {
  // C1: no rematches.
  if (a.opponents.has(b.id)) {
    return DynamicUint.from(0);
  }

  // Pack criteria so that criteria[0] (highest priority) is in the most
  // significant bits. We iterate forward: for each criterion, shift the
  // accumulator left to make room for THIS criterion's bits, then OR the
  // value in.
  const result = DynamicUint.from(0);
  for (let i = 0; i < criteria.length; i++) {
    const criterion = criteria[i]!;
    const bits = resolveBits(criterion.bits, ctx);
    if (i > 0) {
      // Shift previous (higher-priority) bits left to make room.
      result.shiftGrow(bits);
    }
    const value = criterion.evaluate(a, b, ctx);
    result.or(value);
  }
  // After the loop, criteria[0]'s bits are in the highest position because
  // they were shifted left once per subsequent criterion.

  return result;
}

/**
 * Compute the maximum possible edge weight for the given criteria. Used to
 * initialize the blossom's maxEdgeWeight.
 */
function computeMaxWeight(
  criteria: Criterion[],
  ctx: BracketContext,
): DynamicUint {
  const result = DynamicUint.from(0);
  for (let i = 0; i < criteria.length; i++) {
    const bits = resolveBits(criteria[i]!.bits, ctx);
    if (i > 0) {
      result.shiftGrow(bits);
    }
    // Maximum value for N bits = (1 << bits) - 1
    const maxValue = (1 << bits) - 1;
    result.or(maxValue);
  }
  return result;
}

export type { BracketContext, Criterion };
export { buildEdgeWeight, computeMaxWeight };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/weights.spec.ts` Expected: PASS

- [ ] **Step 5: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/weights.ts src/__tests__/weights.spec.ts
git commit -m "feat: add data-driven weight encoding for blossom matching"
```

---

## Task 5: Dutch System

**Files:**

- Rewrite: `src/dutch.ts`
- Rewrite: `src/__tests__/dutch.spec.ts`
- Keep: `src/__tests__/dutch.fixtures.spec.ts` (integration tests)
- Keep: `src/dutch-entry.ts`

This is the largest and most complex system. It defines 16 criteria (C6-C21),
the two-pass blossom algorithm (feasibility + bracket-by-bracket), color
allocation rules per C.04.1, and bye selection.

- [ ] **Step 1: Write failing unit tests for Dutch pair function**

```ts
// src/__tests__/dutch.spec.ts
import { describe, expect, it } from 'vitest';

import { pair } from '../dutch.js';

import type { Game, Player } from '../types.js';

const FOUR_PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

describe('dutch', () => {
  describe('round 1', () => {
    it('pairs top half vs bottom half', () => {
      const result = pair(FOUR_PLAYERS, []);
      expect(result.pairings).toHaveLength(2);
      expect(result.byes).toHaveLength(0);
      const topHalf = new Set(['A', 'B']);
      for (const pairing of result.pairings) {
        expect(topHalf.has(pairing.white) !== topHalf.has(pairing.black)).toBe(
          true,
        );
      }
    });

    it('assigns bye to lowest-rated when odd count', () => {
      const result = pair(FOUR_PLAYERS.slice(0, 3), []);
      expect(result.byes).toHaveLength(1);
      expect(result.byes[0]?.player).toBe('C');
    });
  });

  describe('no rematches', () => {
    it('avoids pairing players who have already met', () => {
      const round1: Game[] = [
        { black: 'C', result: 1, white: 'A' },
        { black: 'D', result: 1, white: 'B' },
      ];
      const result = pair(FOUR_PLAYERS, [round1]);
      const pairs = result.pairings.map((p) =>
        [p.white, p.black].toSorted().join('-'),
      );
      expect(pairs).not.toContain('A-C');
      expect(pairs).not.toContain('B-D');
    });
  });

  describe('completeness', () => {
    it('pairs all players exactly once', () => {
      const result = pair(FOUR_PLAYERS, []);
      const allIds = result.pairings.flatMap((p) => [p.white, p.black]);
      expect(new Set(allIds).size).toBe(4);
    });
  });

  describe('color allocation', () => {
    it('alternates colors for players', () => {
      // After round 1 where A played white, A should get black next
      const round1: Game[] = [
        { black: 'C', result: 1, white: 'A' },
        { black: 'D', result: 0.5, white: 'B' },
      ];
      const result = pair(FOUR_PLAYERS, [round1]);
      const pairingWithA = result.pairings.find(
        (p) => p.white === 'A' || p.black === 'A',
      );
      expect(pairingWithA?.black).toBe('A');
    });
  });

  describe('validation', () => {
    it('throws RangeError with fewer than 2 players', () => {
      expect(() => pair([FOUR_PLAYERS[0]!], [])).toThrow(RangeError);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/dutch.spec.ts` Expected: FAIL

- [ ] **Step 3: Implement Dutch system**

Rewrite `src/dutch.ts`. This is the core implementation. Structure:

1. **Dutch criteria array** (`DUTCH_CRITERIA: Criterion[]`) -- 16 entries
   encoding C6-C21 as described in the spec. Each criterion's `evaluate`
   function takes two `PlayerState` objects and a `BracketContext` and returns a
   number.

2. **Dutch color rules** (`DUTCH_COLOR_RULES: ColorRule[]`) -- 7 rules per
   C.04.1 Article 4.5.

3. **`pair(players, games)`** function implementing the two-pass algorithm:
   - Build player states
   - Sort by score desc, TPN asc
   - Feasibility pass (all-pairs blossom)
   - Determine bye assignee score
   - Bracket-by-bracket pass
   - Color allocation
   - Return result

Refer to `docs/C0403.md` for the exact FIDE criteria definitions and to the spec
at `docs/superpowers/specs/2026-04-18-swiss-pairing-rewrite-design.md` for the
weight layout table.

Use bbpPairings' `dutch.cpp` `computeEdgeWeight` function as a reference for the
exact encoding of each criterion. The key file to cross-reference is:
https://github.com/BieremaBoyzProgramming/bbpPairings/blob/master/src/swisssystems/dutch.cpp

- [ ] **Step 4: Run unit tests**

Run: `pnpm test src/__tests__/dutch.spec.ts` Expected: PASS

- [ ] **Step 5: Run fixture tests**

Run: `pnpm test src/__tests__/dutch.fixtures.spec.ts` Expected: PASS -- these
test exact FIDE-correct pairings from bbpPairings test data. If any fail, debug
by comparing the weight encoding with bbpPairings' `computeEdgeWeight`.

- [ ] **Step 6: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/dutch.ts src/__tests__/dutch.spec.ts
git commit -m "feat: rewrite Dutch system with weighted blossom matching"
```

---

## Task 6: Dubov System

**Files:**

- Rewrite: `src/dubov.ts`
- Rewrite: `src/__tests__/dubov.spec.ts`
- Keep: `src/dubov-entry.ts`

Dubov differs from Dutch in: ARO-based ranking, fewer criteria (no round -2
float tracking), G1/G2 color group split.

- [ ] **Step 1: Write failing tests**

```ts
// src/__tests__/dubov.spec.ts
import { describe, expect, it } from 'vitest';

import { pair } from '../dubov.js';

import type { Game, Player } from '../types.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

describe('dubov', () => {
  it('pairs all players in round 1', () => {
    const result = pair(PLAYERS, []);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(0);
  });

  it('avoids rematches', () => {
    const round1: Game[] = [
      { black: 'C', result: 1, white: 'A' },
      { black: 'D', result: 1, white: 'B' },
    ];
    const result = pair(PLAYERS, [round1]);
    const pairs = result.pairings.map((p) =>
      [p.white, p.black].toSorted().join('-'),
    );
    expect(pairs).not.toContain('A-C');
    expect(pairs).not.toContain('B-D');
  });

  it('assigns bye when odd number of players', () => {
    const result = pair(PLAYERS.slice(0, 3), []);
    expect(result.byes).toHaveLength(1);
  });

  it('throws RangeError with fewer than 2 players', () => {
    expect(() => pair([PLAYERS[0]!], [])).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Implement Dubov system**

Rewrite `src/dubov.ts`. Defines:

- `DUBOV_CRITERIA: Criterion[]` -- ~10 criteria. Refer to `docs/C040401.md`.
- Dubov ranking comparator: score desc, ARO desc, TPN asc. ARO = average rating
  of opponents. Requires `Player.rating` and opponent lookup.
- Color rules: same as Dutch (reuse `DUTCH_COLOR_RULES` from `dutch.ts`, or
  define shared rules in `utilities.ts`).
- `pair(players, games)` function using the same two-pass blossom approach.

- [ ] **Step 3: Run tests**

Run: `pnpm test src/__tests__/dubov.spec.ts` Expected: PASS

- [ ] **Step 4: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dubov.ts src/__tests__/dubov.spec.ts
git commit -m "feat: rewrite Dubov system with weighted blossom matching"
```

---

## Task 7: Burstein System

**Files:**

- Rewrite: `src/burstein.ts`
- Rewrite: `src/__tests__/burstein.spec.ts`
- Keep: `src/burstein-entry.ts`

Burstein differs from Dutch in: BSN ranking via Buchholz then Sonneborn-Berger
index, ~10 criteria, virtual zeroes in lexicographic ordering.

- [ ] **Step 1: Write failing tests**

```ts
// src/__tests__/burstein.spec.ts
import { describe, expect, it } from 'vitest';

import { pair } from '../burstein.js';

import type { Game, Player } from '../types.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

describe('burstein', () => {
  it('pairs all players in round 1', () => {
    const result = pair(PLAYERS, []);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(0);
  });

  it('avoids rematches', () => {
    const round1: Game[] = [
      { black: 'C', result: 1, white: 'A' },
      { black: 'D', result: 1, white: 'B' },
    ];
    const result = pair(PLAYERS, [round1]);
    const pairs = result.pairings.map((p) =>
      [p.white, p.black].toSorted().join('-'),
    );
    expect(pairs).not.toContain('A-C');
    expect(pairs).not.toContain('B-D');
  });

  it('assigns bye when odd number of players', () => {
    const result = pair(PLAYERS.slice(0, 3), []);
    expect(result.byes).toHaveLength(1);
  });

  it('throws RangeError with fewer than 2 players', () => {
    expect(() => pair([PLAYERS[0]!], [])).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Implement Burstein system**

Rewrite `src/burstein.ts`. Refer to `docs/C040402.md`. Key differences:

- Buchholz score and Sonneborn-Berger index for ranking.
- BSN-based lexicographic ordering with virtual zeroes.
- Bye tiebreak: ranking order, not TPN.

- [ ] **Step 3: Run tests**

Run: `pnpm test src/__tests__/burstein.spec.ts` Expected: PASS

- [ ] **Step 4: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/burstein.ts src/__tests__/burstein.spec.ts
git commit -m "feat: rewrite Burstein system with weighted blossom matching"
```

---

## Task 8: Lim System

**Files:**

- Rewrite: `src/lim.ts`
- Rewrite: `src/__tests__/lim.spec.ts`
- Keep: `src/lim-entry.ts`

Lim differs from Dutch in: bi-directional bracket traversal (top and bottom
score groups simultaneously, meeting in the middle), stricter compatibility
constraints, ~12 criteria.

- [ ] **Step 1: Write failing tests**

```ts
// src/__tests__/lim.spec.ts
import { describe, expect, it } from 'vitest';

import { pair } from '../lim.js';

import type { Game, Player } from '../types.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

describe('lim', () => {
  it('pairs all players in round 1', () => {
    const result = pair(PLAYERS, []);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(0);
  });

  it('avoids rematches', () => {
    const round1: Game[] = [
      { black: 'C', result: 1, white: 'A' },
      { black: 'D', result: 1, white: 'B' },
    ];
    const result = pair(PLAYERS, [round1]);
    const pairs = result.pairings.map((p) =>
      [p.white, p.black].toSorted().join('-'),
    );
    expect(pairs).not.toContain('A-C');
    expect(pairs).not.toContain('B-D');
  });

  it('assigns bye when odd number of players', () => {
    const result = pair(PLAYERS.slice(0, 3), []);
    expect(result.byes).toHaveLength(1);
  });

  it('throws RangeError with fewer than 2 players', () => {
    expect(() => pair([PLAYERS[0]!], [])).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Implement Lim system**

Rewrite `src/lim.ts`. Refer to the FIDE handbook:
https://handbook.fide.com/chapter/C040403202602

Key difference: bi-directional bracket traversal. Process the top and bottom
score groups simultaneously, working inward. This changes the bracket-by-bracket
pass -- instead of iterating top-down, alternate between the highest and lowest
unpaired score groups.

- [ ] **Step 3: Run tests**

Run: `pnpm test src/__tests__/lim.spec.ts` Expected: PASS

- [ ] **Step 4: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lim.ts src/__tests__/lim.spec.ts
git commit -m "feat: rewrite Lim system with weighted blossom matching"
```

---

## Task 9: Lexicographic Module Rewrite

**Files:**

- Rewrite: `src/lexicographic.ts`

Clean up the existing lexicographic matching module. Used by Double-Swiss and
Swiss Team. No blossom -- these systems enumerate all perfect matchings and pick
the lexicographically first valid one.

- [ ] **Step 1: Rewrite lexicographic.ts**

Rewrite `src/lexicographic.ts` to use `PlayerState` from the new utilities
instead of computing scores inline. Functions to keep (rewritten):

- `rankByScoreThenTPN(states)` -- sort by score desc, TPN asc.
- `assignLexicographicBye(states, games)` -- bye selection for lexicographic
  systems (lowest score, most matches played, highest TPN).
- `allPerfectMatchings(sorted)` -- enumerate all perfect matchings.
- `matchingIdentifier(matching, states)` -- FIDE matching identifier.
- `pairBracket(bracket, allStates, games, allocateColors)` -- pair a single
  bracket, return first valid matching.
- `pairAllBrackets(toBePaired, allStates, games, allocateColors)` -- pair all
  score groups with upfloaters.

The `ColorAllocator` type changes to use `PlayerState`:

```ts
type ColorAllocator = (
  a: PlayerState,
  b: PlayerState,
  allStates: PlayerState[],
  games: Game[][],
) => { black: string; white: string };
```

- [ ] **Step 2: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lexicographic.ts
git commit -m "refactor: rewrite lexicographic module to use PlayerState"
```

---

## Task 10: Double-Swiss System

**Files:**

- Rewrite: `src/double-swiss.ts`
- Rewrite: `src/__tests__/double-swiss.spec.ts`
- Keep: `src/double-entry.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/__tests__/double-swiss.spec.ts
import { describe, expect, it } from 'vitest';

import { pair } from '../double-swiss.js';

import type { Game, Player } from '../types.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

describe('double-swiss', () => {
  it('pairs all players in round 1', () => {
    const result = pair(PLAYERS, []);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(0);
  });

  it('avoids rematches', () => {
    const round1: Game[] = [
      { black: 'C', result: 1, white: 'A' },
      { black: 'D', result: 1, white: 'B' },
    ];
    const result = pair(PLAYERS, [round1]);
    const pairs = result.pairings.map((p) =>
      [p.white, p.black].toSorted().join('-'),
    );
    expect(pairs).not.toContain('A-C');
    expect(pairs).not.toContain('B-D');
  });

  it('assigns bye when odd number of players', () => {
    const result = pair(PLAYERS.slice(0, 3), []);
    expect(result.byes).toHaveLength(1);
  });

  it('throws RangeError with fewer than 2 players', () => {
    expect(() => pair([PLAYERS[0]!], [])).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Implement Double-Swiss system**

Rewrite `src/double-swiss.ts`. Uses lexicographic matching from Task 9. Defines
`allocateDoubleColors` per C.04.5 Article 4.3 (5 rules). Refer to:
https://handbook.fide.com/chapter/DoubleSwissSystem202602

- [ ] **Step 3: Run tests**

Run: `pnpm test src/__tests__/double-swiss.spec.ts` Expected: PASS

- [ ] **Step 4: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/double-swiss.ts src/__tests__/double-swiss.spec.ts
git commit -m "feat: rewrite Double-Swiss system"
```

---

## Task 11: Swiss Team System

**Files:**

- Rewrite: `src/swiss-team.ts`
- Rewrite: `src/__tests__/swiss-team.spec.ts`
- Keep: `src/team-entry.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/__tests__/swiss-team.spec.ts
import { describe, expect, it } from 'vitest';

import { pair } from '../swiss-team.js';

import type { Game, Player } from '../types.js';

const TEAMS: Player[] = [
  { id: 'T1', rating: 2200 },
  { id: 'T2', rating: 2100 },
  { id: 'T3', rating: 2000 },
  { id: 'T4', rating: 1900 },
];

describe('swiss-team', () => {
  it('pairs all teams in round 1', () => {
    const result = pair(TEAMS, []);
    expect(result.pairings).toHaveLength(2);
    expect(result.byes).toHaveLength(0);
  });

  it('avoids rematches', () => {
    const round1: Game[] = [
      { black: 'T3', result: 1, white: 'T1' },
      { black: 'T4', result: 1, white: 'T2' },
    ];
    const result = pair(TEAMS, [round1]);
    const pairs = result.pairings.map((p) =>
      [p.white, p.black].toSorted().join('-'),
    );
    expect(pairs).not.toContain('T1-T3');
    expect(pairs).not.toContain('T2-T4');
  });

  it('assigns bye when odd number of teams', () => {
    const result = pair(TEAMS.slice(0, 3), []);
    expect(result.byes).toHaveLength(1);
  });

  it('throws RangeError with fewer than 2 teams', () => {
    expect(() => pair([TEAMS[0]!], [])).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Implement Swiss Team system**

Rewrite `src/swiss-team.ts`. Uses lexicographic matching from Task 9. Defines
`allocateTeamColors` per C.04.6 Article 4.3 (9 rules, includes Type A
preference). Refer to:
https://handbook.fide.com/chapter/SwissTeamPairingSystem202602

- [ ] **Step 3: Run tests**

Run: `pnpm test src/__tests__/swiss-team.spec.ts` Expected: PASS

- [ ] **Step 4: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/swiss-team.ts src/__tests__/swiss-team.spec.ts
git commit -m "feat: rewrite Swiss Team system"
```

---

## Task 12: Integration and Final Verification

**Files:**

- Verify: all `*-entry.ts` files still work
- Verify: `src/index.ts` re-exports correctly
- Run: full test suite + lint + build

- [ ] **Step 1: Verify entry points compile**

Check that all entry files (`dutch-entry.ts`, `dubov-entry.ts`,
`burstein-entry.ts`, `lim-entry.ts`, `double-entry.ts`, `team-entry.ts`) import
from the rewritten modules and re-export `pair`. Update import paths if needed.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test` Expected: all tests PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint` Expected: PASS

- [ ] **Step 4: Run build**

Run: `pnpm build` Expected: PASS -- `dist/` contains all entry points and types.

- [ ] **Step 5: Run fixture tests specifically**

Run: `pnpm test src/__tests__/dutch.fixtures.spec.ts` Expected: PASS -- exact
FIDE-correct pairings match bbpPairings output.

- [ ] **Step 6: Clean up unused files**

If any old modules are no longer imported (e.g. old `blossom.ts` helpers),
remove them.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: integration verification and cleanup"
```

---

## Dependency Graph

```
Task 1 (DynamicUint)
  └── Task 2 (Blossom) ─────────────────────────┐
  └── Task 4 (Weights) ──┐                      │
                          ├── Task 5 (Dutch) ────┤
Task 3 (Utilities) ──────┤                      │
                          ├── Task 6 (Dubov) ────┤
                          ├── Task 7 (Burstein) ─┤
                          ├── Task 8 (Lim) ──────┤
                          │                      │
                          ├── Task 9 (Lexicographic) ──┐
                          │                            ├── Task 10 (Double-Swiss)
                          │                            └── Task 11 (Swiss Team)
                          │
                          └──────────────────────────── Task 12 (Integration)
```

Tasks 1-4 are sequential (each depends on the previous). Tasks 5-8 are
independent (can run in parallel after Tasks 1-4). Tasks 9-11: Task 9 first,
then 10-11 in parallel. Task 12 depends on all previous tasks.
