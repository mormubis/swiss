/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * IterablePool — fixed-capacity object pool with linked-list iteration.
 *
 * Matches the allocation/iteration semantics of bbpPairings'
 * utility::memory::IterablePool. Elements are allocated from a LIFO free
 * list and appended to a doubly-linked iteration list.
 *
 * @internal Not part of the public API.
 */
class IterablePool<T> {
  /** First allocated slot (visible or hidden), or -1 if none. */
  #allocatedHead = -1;

  /** Per-slot backward link for allocated slots (-1 = none). */
  readonly #backward: Int32Array;

  /**
   * Per-slot forward link. For iterable slots: next iterable slot index
   * (-1 = end). For free slots: next free slot index (-1 = end).
   * For hidden (allocated non-iterable) slots: next allocated slot index.
   */
  readonly #forward: Int32Array;

  /** First visible (iterable) slot, or -1 if none. */
  #head = -1;

  /** Slot storage. undefined = unallocated. */
  readonly #slots: (T | undefined)[];

  /** Last allocated slot (visible or hidden), or -1 if none. */
  #tail = -1;

  /** First unallocated (free) slot, or -1 if none. */
  #unallocatedHead: number;

  constructor(capacity: number) {
    this.#slots = Array.from<T | undefined>({ length: capacity });
    this.#forward = new Int32Array(capacity).fill(-1);
    this.#backward = new Int32Array(capacity).fill(-1);
    // Initialize free list: 0 → 1 → 2 → ... → capacity-1
    this.#unallocatedHead = capacity > 0 ? 0 : -1;
    for (let index = 0; index < capacity - 1; index++) {
      this.#forward[index] = index + 1;
    }
  }

  /** Iterate over visible (non-hidden) elements in linked-list order. */
  *[Symbol.iterator](): Generator<T> {
    let slot = this.#head;
    while (slot !== -1) {
      yield this.#slots[slot] as T;
      slot = this.#forward[slot]!;
    }
  }

  /** Allocate a slot, store `value`, append to iteration tail. Returns slot index. */
  construct(value: T): number {
    const slot = this.#unallocatedHead;
    if (slot === -1) throw new RangeError('IterablePool: capacity exceeded');

    // Remove from free list
    this.#unallocatedHead = this.#forward[slot]!;

    // Store value
    this.#slots[slot] = value;

    // Append to iteration tail
    this.#backward[slot] = this.#tail;
    if (this.#tail !== -1) {
      this.#forward[this.#tail] = slot;
    }
    this.#tail = slot;
    this.#forward[slot] = -1;

    if (this.#head === -1) this.#head = slot;
    if (this.#allocatedHead === -1) this.#allocatedHead = slot;

    return slot;
  }

  /** Destroy: remove from lists entirely, return slot to free list. */
  destroy(slot: number): void {
    const fwd = this.#forward[slot]!;
    const bwd = this.#backward[slot]!;

    // Unlink from whatever list it's in
    if (fwd === -1) {
      this.#tail = bwd;
    } else {
      this.#backward[fwd] = bwd;
    }

    if (bwd === -1) {
      this.#allocatedHead = fwd;
    } else {
      this.#forward[bwd] = fwd;
    }

    if (this.#head === slot) this.#head = fwd;

    // Clear value
    this.#slots[slot] = undefined;

    // Push to free list (LIFO)
    this.#forward[slot] = this.#unallocatedHead;
    this.#unallocatedHead = slot;
  }

  /** Get value at slot index. */
  get(slot: number): T {
    return this.#slots[slot] as T;
  }

  /** Remove from iteration list but keep alive. */
  hide(slot: number): void {
    const fwd = this.#forward[slot]!;
    const bwd = this.#backward[slot]!;

    // Unlink from iteration list
    if (fwd === -1) {
      this.#tail = bwd;
    } else {
      this.#backward[fwd] = bwd;
    }

    if (bwd === -1) {
      this.#allocatedHead = fwd;
    } else {
      this.#forward[bwd] = fwd;
    }

    if (this.#head === slot) this.#head = fwd;

    // Prepend to allocated (non-iterable) head
    if (this.#allocatedHead !== -1) {
      this.#backward[this.#allocatedHead] = slot;
    }
    this.#forward[slot] = this.#allocatedHead;

    this.#allocatedHead = slot;
    this.#backward[slot] = -1;

    if (this.#tail === -1) this.#tail = this.#allocatedHead;
  }
}

export { IterablePool };
