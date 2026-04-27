import { describe, expect, it } from 'vitest';

import { IterablePool } from '../matching/iterable-pool.js';

describe('IterablePool', () => {
  it('constructs elements and iterates in insertion order', () => {
    const pool = new IterablePool<string>(10);
    pool.construct('a');
    pool.construct('b');
    pool.construct('c');
    expect([...pool]).toEqual(['a', 'b', 'c']);
  });

  it('destroy removes from iteration', () => {
    const pool = new IterablePool<string>(10);
    pool.construct('a');
    const index1 = pool.construct('b');
    pool.construct('c');
    pool.destroy(index1);
    expect([...pool]).toEqual(['a', 'c']);
  });

  it('destroyed slots are reused by next construct (LIFO)', () => {
    const pool = new IterablePool<string>(10);
    pool.construct('a');
    const index1 = pool.construct('b');
    pool.destroy(index1);
    // Next construct reuses slot index1, but appears at END of iteration
    const index2 = pool.construct('c');
    expect(index2).toBe(index1); // same slot reused (LIFO)
    expect([...pool]).toEqual(['a', 'c']); // 'c' at end, not at index1's old position
  });

  it('hide removes from iteration but keeps alive', () => {
    const pool = new IterablePool<string>(10);
    pool.construct('a');
    const index1 = pool.construct('b');
    pool.construct('c');
    pool.hide(index1);
    expect([...pool]).toEqual(['a', 'c']);
    // The element is still accessible:
    expect(pool.get(index1)).toBe('b');
  });

  it('destroy after hide works', () => {
    const pool = new IterablePool<string>(5);
    pool.construct('a');
    const index1 = pool.construct('b');
    pool.hide(index1);
    pool.destroy(index1);
    expect([...pool]).toEqual(['a']);
    const index2 = pool.construct('c');
    expect(index2).toBe(index1); // slot reused
    expect([...pool]).toEqual(['a', 'c']);
  });

  it('construct appends to tail even after destroy+reuse', () => {
    const pool = new IterablePool<string>(5);
    pool.construct('a'); // slot 0
    pool.construct('b'); // slot 1
    pool.construct('c'); // slot 2
    pool.destroy(0); // free slot 0
    pool.construct('d'); // reuses slot 0, appends to tail
    expect([...pool]).toEqual(['b', 'c', 'd']);
  });

  it('iteration order matches C++ IterablePool for create-destroy-create cycle', () => {
    const pool = new IterablePool<number>(10);
    pool.construct(0); // slot 0
    pool.construct(1); // slot 1
    pool.construct(2); // slot 2
    pool.construct(3); // slot 3
    pool.destroy(1); // free slot 1
    pool.destroy(2); // free slot 2
    pool.construct(4); // reuses slot 2 (LIFO), appends to tail
    pool.construct(5); // reuses slot 1 (LIFO), appends to tail
    expect([...pool]).toEqual([0, 3, 4, 5]);
  });
});
