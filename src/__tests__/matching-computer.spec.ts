import { describe, expect, it } from 'vitest';

import { DynamicUint } from '../dynamic-uint.js';
import { Vertex } from '../matching/vertex.js';

describe('Vertex', () => {
  const zero = DynamicUint.zero(1);

  describe('constructor', () => {
    it('initializes with the correct index', () => {
      const v = new Vertex(42, zero);
      expect(v.vertexIndex).toBe(42);
    });

    it('initializes with index 0', () => {
      const v = new Vertex(0, zero);
      expect(v.vertexIndex).toBe(0);
    });

    it('edgeWeights starts empty', () => {
      const v = new Vertex(0, zero);
      expect(v.edgeWeights).toEqual([]);
      expect(v.edgeWeights.length).toBe(0);
    });

    it('vertexListHead points to self', () => {
      const v = new Vertex(0, zero);
      expect(v.vertexListHead).toBe(v);
    });

    it('vertexListTail points to self', () => {
      const v = new Vertex(0, zero);
      expect(v.vertexListTail).toBe(v);
    });

    it('nextVertex is undefined', () => {
      const v = new Vertex(0, zero);
      expect(v.nextVertex).toBeUndefined();
    });

    it('minOuterEdge is undefined', () => {
      const v = new Vertex(0, zero);
      expect(v.minOuterEdge).toBeUndefined();
    });

    it('rootBlossom is undefined', () => {
      const v = new Vertex(0, zero);
      expect(v.rootBlossom).toBeUndefined();
    });

    it('parentBlossom is undefined', () => {
      const v = new Vertex(0, zero);
      expect(v.parentBlossom).toBeUndefined();
    });

    it('minOuterEdgeResistance is a clone (independent copy) of zero', () => {
      const v = new Vertex(0, zero);
      expect(v.minOuterEdgeResistance.isZero()).toBe(true);
      // Mutating zero does not affect the vertex's copy
      zero.add(1);
      expect(v.minOuterEdgeResistance.isZero()).toBe(true);
      // Restore zero for other tests
      zero.subtract(1);
    });
  });

  describe('isVertex', () => {
    it('returns true', () => {
      const v = new Vertex(0, zero);
      expect(v.isVertex).toBe(true);
    });
  });

  describe('vertexIndex immutability', () => {
    it('vertexIndex is readonly', () => {
      const v = new Vertex(7, zero);
      // TypeScript prevents assignment at compile time; verify the value is stable
      expect(v.vertexIndex).toBe(7);
    });
  });

  describe('separate instances are independent', () => {
    it('two vertices have independent vertexListHead/Tail', () => {
      const a = new Vertex(0, zero);
      const b = new Vertex(1, zero);
      expect(a.vertexListHead).toBe(a);
      expect(b.vertexListHead).toBe(b);
    });

    it('two vertices have independent edgeWeights arrays', () => {
      const a = new Vertex(0, zero);
      const b = new Vertex(1, zero);
      a.edgeWeights.push(DynamicUint.from(5));
      expect(b.edgeWeights.length).toBe(0);
    });
  });
});
