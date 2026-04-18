/**
 * Mutable arbitrary-precision unsigned integer backed by Uint32Array.
 *
 * Words are stored in little-endian order: word 0 is the least significant.
 * Each word is a 32-bit unsigned integer, matching JS bitwise operator width.
 *
 * Note: `add` and `subtract` do NOT grow capacity — callers must pre-size
 * via `shiftGrow` if overflow is possible.
 *
 * @internal Not part of the public API.
 */
class DynamicUint {
  #data: Uint32Array;

  private constructor(data: Uint32Array) {
    this.#data = data;
  }

  get words(): number {
    return this.#data.length;
  }

  /**
   * Adds `value` to this in place.
   *
   * When `value` is a `number` it must fit in 32 bits (0 – 0xFFFF_FFFF).
   * Values larger than 0xFFFF_FFFF are silently truncated by `>>> 0`.
   */
  add(value: number | DynamicUint): this {
    if (typeof value === 'number') {
      let carry = value >>> 0;
      for (let index = 0; index < this.#data.length && carry !== 0; index++) {
        const sum = (this.#data[index] ?? 0) + carry;
        this.#data[index] = sum >>> 0;
        carry = Math.floor(sum / 0x1_00_00_00_00);
      }
    } else {
      let carry = 0;
      const length = Math.max(this.#data.length, value.#data.length);
      for (let index = 0; index < length; index++) {
        const a = index < this.#data.length ? (this.#data[index] ?? 0) : 0;
        const b = index < value.#data.length ? (value.#data[index] ?? 0) : 0;
        const sum = a + b + carry;
        if (index < this.#data.length) {
          this.#data[index] = sum >>> 0;
        }
        carry = Math.floor(sum / 0x1_00_00_00_00);
      }
    }
    return this;
  }

  and(value: number): this {
    this.#data[0] = ((this.#data[0] ?? 0) & (value >>> 0)) >>> 0;
    for (let index = 1; index < this.#data.length; index++) {
      this.#data[index] = 0;
    }
    return this;
  }

  clone(): DynamicUint {
    return new DynamicUint(new Uint32Array(this.#data));
  }

  compareTo(other: DynamicUint): -1 | 0 | 1 {
    const length = Math.max(this.#data.length, other.#data.length);
    for (let index = length - 1; index >= 0; index--) {
      const a = index < this.#data.length ? (this.#data[index] ?? 0) : 0;
      const b = index < other.#data.length ? (other.#data[index] ?? 0) : 0;
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }

  static from(value: number): DynamicUint {
    const lo = value >>> 0;
    const hi = Math.floor(value / 0x1_00_00_00_00) >>> 0;
    if (hi !== 0) {
      const data = new Uint32Array(2);
      data[0] = lo;
      data[1] = hi;
      return new DynamicUint(data);
    }

    const data = new Uint32Array(1);
    data[0] = lo;
    return new DynamicUint(data);
  }

  isZero(): boolean {
    for (const word of this.#data) {
      if (word !== 0) return false;
    }
    return true;
  }

  or(value: number | DynamicUint): this {
    if (typeof value === 'number') {
      this.#data[0] = ((this.#data[0] ?? 0) | (value >>> 0)) >>> 0;
    } else {
      const length = Math.min(this.#data.length, value.#data.length);
      for (let index = 0; index < length; index++) {
        this.#data[index] =
          ((this.#data[index] ?? 0) | (value.#data[index] ?? 0)) >>> 0;
      }
    }
    return this;
  }

  shiftGrow(bits: number): this {
    if (bits === 0) return this;

    // Find the highest set bit across all words
    let topBit = -1;
    for (let index = this.#data.length - 1; index >= 0; index--) {
      const w = this.#data[index] ?? 0;
      if (w !== 0) {
        topBit = index * 32 + (31 - Math.clz32(w));
        break;
      }
    }

    if (topBit === -1) {
      // value is zero, no growth needed
      return this;
    }

    const resultTopBit = topBit + bits;
    const neededWords = Math.ceil((resultTopBit + 1) / 32);

    if (neededWords > this.#data.length) {
      const newData = new Uint32Array(neededWords);
      newData.set(this.#data);
      this.#data = newData;
    }

    return this.shiftLeft(bits);
  }

  shiftLeft(bits: number): this {
    if (bits === 0) return this;
    const wordShift = Math.floor(bits / 32);
    const bitShift = bits % 32;
    const length = this.#data.length;

    for (let index = length - 1; index >= 0; index--) {
      const sourceIndex = index - wordShift;
      if (sourceIndex < 0) {
        this.#data[index] = 0;
      } else if (bitShift === 0) {
        this.#data[index] = this.#data[sourceIndex] ?? 0;
      } else {
        const lo = (this.#data[sourceIndex] ?? 0) << bitShift;
        const hiSource =
          sourceIndex - 1 >= 0 ? (this.#data[sourceIndex - 1] ?? 0) : 0;
        const hi = hiSource >>> (32 - bitShift);
        this.#data[index] = (lo | hi) >>> 0;
      }
    }
    return this;
  }

  shiftRight(bits: number): this {
    if (bits === 0) return this;
    const wordShift = Math.floor(bits / 32);
    const bitShift = bits % 32;
    const length = this.#data.length;

    for (let index = 0; index < length; index++) {
      const sourceIndex = index + wordShift;
      if (sourceIndex >= length) {
        this.#data[index] = 0;
      } else if (bitShift === 0) {
        this.#data[index] = this.#data[sourceIndex] ?? 0;
      } else {
        const lo = (this.#data[sourceIndex] ?? 0) >>> bitShift;
        const hiSource =
          sourceIndex + 1 < length ? (this.#data[sourceIndex + 1] ?? 0) : 0;
        const hi = hiSource << (32 - bitShift);
        this.#data[index] = (lo | hi) >>> 0;
      }
    }
    return this;
  }

  /**
   * Subtracts `value` from this in place.
   *
   * When `value` is a `number` it must fit in 32 bits (0 – 0xFFFF_FFFF).
   * Values larger than 0xFFFF_FFFF are silently truncated by `>>> 0`.
   */
  subtract(value: number | DynamicUint): this {
    if (typeof value === 'number') {
      let borrow = value >>> 0;
      for (let index = 0; index < this.#data.length && borrow !== 0; index++) {
        const diff = (this.#data[index] ?? 0) - borrow;
        if (diff < 0) {
          this.#data[index] = (diff + 0x1_00_00_00_00) >>> 0;
          borrow = 1;
        } else {
          this.#data[index] = diff >>> 0;
          borrow = 0;
        }
      }
    } else {
      let borrow = 0;
      const length = Math.max(this.#data.length, value.#data.length);
      for (let index = 0; index < length; index++) {
        const a = index < this.#data.length ? (this.#data[index] ?? 0) : 0;
        const b = index < value.#data.length ? (value.#data[index] ?? 0) : 0;
        const diff = a - b - borrow;
        if (index < this.#data.length) {
          this.#data[index] =
            ((diff % 0x1_00_00_00_00) + 0x1_00_00_00_00) % 0x1_00_00_00_00;
        }
        borrow = diff < 0 ? 1 : 0;
      }
    }
    return this;
  }

  static zero(words: number): DynamicUint {
    return new DynamicUint(new Uint32Array(words));
  }
}

export { DynamicUint };
