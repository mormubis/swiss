import { describe, expect, it } from 'vitest';

import { DynamicUint } from '../dynamic-uint.js';
import {
  ParentBlossom,
  RootBlossom,
  getAncestorOfVertex,
  setPointersFromAncestor,
} from '../matching/blossom.js';
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

// ---------------------------------------------------------------------------
// RootBlossom
// ---------------------------------------------------------------------------

describe('RootBlossom', () => {
  const aboveMax = DynamicUint.from(100);

  const makeGraph = () => ({
    aboveMaxEdgeWeight: aboveMax,
    parentBlossoms: [] as ParentBlossom[],
    rootBlossoms: [] as RootBlossom[],
    vertexDualVariables: [] as DynamicUint[],
  });

  describe('constructor', () => {
    it('stores rootChild and baseVertex', () => {
      const v = new Vertex(0, DynamicUint.zero(1));
      const graph = makeGraph();
      const root = new RootBlossom(v, v, undefined, graph);
      expect(root.rootChild).toBe(v);
      expect(root.baseVertex).toBe(v);
    });

    it('baseVertexMatch is undefined for an exposed blossom', () => {
      const v = new Vertex(0, DynamicUint.zero(1));
      const graph = makeGraph();
      const root = new RootBlossom(v, v, undefined, graph);
      expect(root.baseVertexMatch).toBeUndefined();
    });

    it('labeledVertex and labelingVertex default to undefined', () => {
      const v = new Vertex(0, DynamicUint.zero(1));
      const graph = makeGraph();
      const root = new RootBlossom(v, v, undefined, graph);
      expect(root.labeledVertex).toBeUndefined();
      expect(root.labelingVertex).toBeUndefined();
    });

    it('minOuterEdges defaults to empty array', () => {
      const v = new Vertex(0, DynamicUint.zero(1));
      const graph = makeGraph();
      const root = new RootBlossom(v, v, undefined, graph);
      expect(root.minOuterEdges).toEqual([]);
    });
  });

  describe('prepareVertexForWeightAdjustments', () => {
    it('no-op case: single vertex, no match', () => {
      const v = new Vertex(0, DynamicUint.zero(1));
      v.dualVariable = DynamicUint.zero(1);
      const graph = makeGraph();
      const root = new RootBlossom(v, v, undefined, graph);
      v.rootBlossom = root;
      graph.rootBlossoms.push(root);

      root.prepareVertexForWeightAdjustments(v, graph);

      expect(root.baseVertex).toBe(v);
      expect(root.baseVertexMatch).toBeUndefined();
      // dual should be aboveMaxEdgeWeight >> 1 = 50
      expect(v.dualVariable.toBigInt()).toBe(50n);
    });

    it('disconnects match on both sides', () => {
      const zero = DynamicUint.zero(1);
      const v0 = new Vertex(0, zero);
      const v1 = new Vertex(1, zero);
      v0.dualVariable = DynamicUint.zero(1);
      v1.dualVariable = DynamicUint.zero(1);

      const graph = makeGraph();
      const root0 = new RootBlossom(v0, v0, undefined, graph);
      const root1 = new RootBlossom(v1, v1, undefined, graph);
      v0.rootBlossom = root0;
      v1.rootBlossom = root1;

      // Simulate a match between v0 and v1.
      root0.baseVertexMatch = v1;
      root1.baseVertexMatch = v0;

      graph.rootBlossoms.push(root0, root1);

      root0.prepareVertexForWeightAdjustments(v0, graph);

      expect(root0.baseVertexMatch).toBeUndefined();
      expect(root1.baseVertexMatch).toBeUndefined();
    });

    it('sets baseVertex to the provided vertex', () => {
      const zero = DynamicUint.zero(1);
      const v = new Vertex(3, zero);
      v.dualVariable = DynamicUint.zero(1);
      const graph = makeGraph();
      const root = new RootBlossom(v, v, undefined, graph);
      v.rootBlossom = root;
      graph.rootBlossoms.push(root);

      root.prepareVertexForWeightAdjustments(v, graph);

      expect(root.baseVertex).toBe(v);
    });
  });

  describe('putVerticesInMatchingOrder', () => {
    it('no-op for single-vertex blossom', () => {
      const v = new Vertex(0, DynamicUint.zero(1));
      const graph = makeGraph();
      const root = new RootBlossom(v, v, undefined, graph);
      v.rootBlossom = root;

      root.putVerticesInMatchingOrder();

      expect(root.rootChild.vertexListHead).toBe(v);
      expect(root.rootChild.vertexListTail).toBe(v);
      expect(v.nextVertex).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// ParentBlossom
// ---------------------------------------------------------------------------

describe('ParentBlossom', () => {
  it('isVertex is false', () => {
    const zero = DynamicUint.zero(1);
    const v = new Vertex(0, zero);
    const aboveMax = DynamicUint.from(100);
    const graph = {
      aboveMaxEdgeWeight: aboveMax,
      parentBlossoms: [] as ParentBlossom[],
      rootBlossoms: [] as RootBlossom[],
      vertexDualVariables: [] as DynamicUint[],
    };
    const root = new RootBlossom(v, v, undefined, graph);
    const pb = new ParentBlossom(DynamicUint.from(4), root, v, v, v);
    expect(pb.isVertex).toBe(false);
  });

  it('stores dualVariable', () => {
    const zero = DynamicUint.zero(1);
    const v = new Vertex(0, zero);
    const aboveMax = DynamicUint.from(100);
    const graph = {
      aboveMaxEdgeWeight: aboveMax,
      parentBlossoms: [] as ParentBlossom[],
      rootBlossoms: [] as RootBlossom[],
      vertexDualVariables: [] as DynamicUint[],
    };
    const root = new RootBlossom(v, v, undefined, graph);
    const dual = DynamicUint.from(8);
    const pb = new ParentBlossom(dual, root, v, v, v);
    expect(pb.dualVariable.toBigInt()).toBe(8n);
  });

  it('subblossom and vertexListHead/Tail are set from constructor', () => {
    const zero = DynamicUint.zero(1);
    const v = new Vertex(0, zero);
    const aboveMax = DynamicUint.from(100);
    const graph = {
      aboveMaxEdgeWeight: aboveMax,
      parentBlossoms: [] as ParentBlossom[],
      rootBlossoms: [] as RootBlossom[],
      vertexDualVariables: [] as DynamicUint[],
    };
    const root = new RootBlossom(v, v, undefined, graph);
    const pb = new ParentBlossom(DynamicUint.from(2), root, v, v, v);
    expect(pb.subblossom).toBe(v);
    expect(pb.vertexListHead).toBe(v);
    expect(pb.vertexListTail).toBe(v);
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('getAncestorOfVertex', () => {
  it('returns the vertex itself when parentBlossom equals ancestor', () => {
    const zero = DynamicUint.zero(1);
    const v = new Vertex(0, zero);
    // vertex.parentBlossom is undefined — ancestor is also undefined
    const result = getAncestorOfVertex(v);
    expect(result).toBe(v);
  });
});

describe('setPointersFromAncestor', () => {
  it('sets subblossom on a single-level parent', () => {
    const zero = DynamicUint.zero(1);
    const v = new Vertex(0, zero);
    const aboveMax = DynamicUint.from(100);
    const graph = {
      aboveMaxEdgeWeight: aboveMax,
      parentBlossoms: [] as ParentBlossom[],
      rootBlossoms: [] as RootBlossom[],
      vertexDualVariables: [] as DynamicUint[],
    };
    const root = new RootBlossom(v, v, undefined, graph);
    const pb = new ParentBlossom(DynamicUint.from(2), root, v, v, v);
    v.parentBlossom = pb;

    setPointersFromAncestor(v, pb, true);

    expect(pb.subblossom).toBe(v);
    expect(pb.iterationStartsWithSubblossom).toBe(true);
  });
});
