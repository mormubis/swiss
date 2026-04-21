import { describe, expect, it } from 'vitest';

import { maxWeightMatching } from '../blossom.js';
import { DynamicUint } from '../dynamic-uint.js';
import {
  ParentBlossom,
  RootBlossom,
  getAncestorOfVertex,
  setPointersFromAncestor,
} from '../matching/blossom.js';
import { Graph } from '../matching/graph.js';
import { Vertex } from '../matching/vertex.js';
import { MatchingComputer } from '../matching-computer.js';

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

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

/**
 * Build a Graph with `n` vertices and maximum edge weight `maxWeight`.
 */
function makeTestGraph(n: number, maxWeight: number): Graph {
  const graph = new Graph(DynamicUint.from(maxWeight));
  for (let index = 0; index < n; index++) graph.addVertex();
  return graph;
}

/**
 * Set a bidirectional edge weight between two vertices.
 * Internally edge weights are stored doubled; user-visible weight is halved.
 * Uses prepareVertexForWeightAdjustments to reset dual variables correctly.
 */
function setEdgeWeight(
  graph: Graph,
  u: number,
  v: number,
  weight: number,
): void {
  // Weights are stored doubled internally.
  const doubled = DynamicUint.from(weight * 2);
  const vu = graph.vertices[u]!;
  const vv = graph.vertices[v]!;
  vu.edgeWeights[v] = doubled.clone();
  vv.edgeWeights[u] = doubled.clone();
}

/**
 * Initialize dual variables for all exposed vertices.
 * In bbpPairings, prepareVertexForWeightAdjustments sets dual = aboveMaxEdgeWeight >> 1.
 * Here we use the same approach — call it on each vertex before computeMatching.
 */
function initializeDuals(graph: Graph): void {
  for (const rb of graph.rootBlossoms) {
    rb.prepareVertexForWeightAdjustments(rb.baseVertex, graph);
  }
}

/**
 * Read the matching result after putVerticesInMatchingOrder.
 * Returns an array where result[i] = j means vertex i is matched to vertex j,
 * and result[i] = i means vertex i is unmatched (self-loop).
 */
function getMatching(graph: Graph): number[] {
  const result = Array.from<number>({ length: graph.vertices.length }).fill(-1);

  for (const rb of graph.rootBlossoms) {
    rb.putVerticesInMatchingOrder();
    const baseIndex = rb.baseVertex.vertexIndex;
    result[baseIndex] = rb.baseVertexMatch
      ? rb.baseVertexMatch.vertexIndex
      : baseIndex; // exposed → self
    // Walk the vertex list for the remaining matched pairs.
    let v = rb.rootChild.vertexListHead.nextVertex;
    while (v !== undefined) {
      const partner = v.nextVertex;
      if (partner === undefined) break;
      result[v.vertexIndex] = partner.vertexIndex;
      result[partner.vertexIndex] = v.vertexIndex;
      v = partner.nextVertex;
    }
  }

  return result;
}

describe('Graph', () => {
  describe('addVertex', () => {
    it('creates a vertex with the correct index', () => {
      const graph = makeTestGraph(0, 100);
      graph.addVertex();
      expect(graph.vertices.length).toBe(1);
      expect(graph.vertices[0]!.vertexIndex).toBe(0);
    });

    it('expands edgeWeights for all vertices', () => {
      const graph = makeTestGraph(0, 100);
      graph.addVertex();
      graph.addVertex();
      // Each vertex should have 2 edge weight slots (one per vertex).
      expect(graph.vertices[0]!.edgeWeights.length).toBe(2);
      expect(graph.vertices[1]!.edgeWeights.length).toBe(2);
    });

    it('creates a RootBlossom for each vertex', () => {
      const graph = makeTestGraph(3, 100);
      expect(graph.rootBlossoms.length).toBe(3);
    });

    it('new vertex has a singleton RootBlossom', () => {
      const graph = makeTestGraph(0, 100);
      graph.addVertex();
      const v = graph.vertices[0]!;
      expect(v.rootBlossom).toBeDefined();
      expect(v.rootBlossom!.rootChild).toBe(v);
      expect(v.rootBlossom!.baseVertex).toBe(v);
    });

    it('dual variables start at zero', () => {
      const graph = makeTestGraph(2, 100);
      expect(graph.vertexDualVariables[0]!.isZero()).toBe(true);
      expect(graph.vertexDualVariables[1]!.isZero()).toBe(true);
    });

    it('dual variable is aliased by vertex.dualVariable', () => {
      const graph = makeTestGraph(1, 100);
      // They must be the same object.
      expect(graph.vertices[0]!.dualVariable).toBe(
        graph.vertexDualVariables[0],
      );
    });

    it('aboveMaxEdgeWeight is strictly greater than 4x maxEdgeWeight', () => {
      const graph = makeTestGraph(0, 10);
      // aboveMaxEdgeWeight = 10 * 4 + 1 = 41
      expect(graph.aboveMaxEdgeWeight.toBigInt()).toBe(41n);
    });
  });

  describe('computeMatching — simple cases', () => {
    it('two vertices, one edge — produces a matching', () => {
      const graph = makeTestGraph(2, 10);
      setEdgeWeight(graph, 0, 1, 10);
      initializeDuals(graph);
      graph.computeMatching();

      const matching = getMatching(graph);
      // Either vertex 0 matched to 1 and vice versa, or both self (no match found).
      // With weight 10 between 0 and 1, they should be matched.
      expect(matching[0]).toBe(1);
      expect(matching[1]).toBe(0);
    });

    it('single vertex — no matching', () => {
      const graph = makeTestGraph(1, 10);
      initializeDuals(graph);
      graph.computeMatching();
      expect(graph.rootBlossoms[0]!.baseVertexMatch).toBeUndefined();
    });

    it('three vertices, one strong edge — matches the strongest pair', () => {
      const graph = makeTestGraph(3, 10);
      setEdgeWeight(graph, 0, 1, 10);
      setEdgeWeight(graph, 1, 2, 5);
      initializeDuals(graph);
      graph.computeMatching();

      const matching = getMatching(graph);
      // Vertices 0 and 1 should be matched (weight 10 vs 5).
      expect(matching[0]).toBe(1);
      expect(matching[1]).toBe(0);
    });
  });

  describe('constructor', () => {
    it('aboveMaxEdgeWeight is set correctly', () => {
      const graph = new Graph(DynamicUint.from(100));
      // aboveMaxEdgeWeight = 100 * 4 + 1 = 401
      expect(graph.aboveMaxEdgeWeight.toBigInt()).toBe(401n);
    });

    it('starts with empty vertices and blossoms', () => {
      const graph = new Graph(DynamicUint.from(10));
      expect(graph.vertices.length).toBe(0);
      expect(graph.rootBlossoms.length).toBe(0);
      expect(graph.parentBlossoms.length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// MatchingComputer
// ---------------------------------------------------------------------------

/**
 * Normalize a matching result for comparison.
 * maxWeightMatching uses -1 for unmatched; MatchingComputer uses i (self).
 * This converts the self-loop convention to -1.
 */
function normalizeMatching(matching: number[]): number[] {
  return matching.map((m, index) => (m === index ? -1 : m));
}

/**
 * Compute total weight of a matching given edges.
 * Each pair (i, j) is counted once.
 */
function totalWeight(
  matching: number[],
  edgeWeights: Map<string, number>,
): number {
  let total = 0;
  const counted = new Set<number>();
  for (const [index, element] of matching.entries()) {
    const partner = element!;
    if (partner !== -1 && partner !== index && !counted.has(index)) {
      const key =
        index < partner ? `${index}-${partner}` : `${partner}-${index}`;
      total += edgeWeights.get(key) ?? 0;
      counted.add(index);
      counted.add(partner);
    }
  }
  return total;
}

/**
 * Build a MatchingComputer, set edges, compute, and return
 * the matching normalized to -1 for unmatched.
 */
function computeViaMatchingComputer(
  vertexCount: number,
  edgeList: [number, number, number][],
): number[] {
  const maxW = Math.max(...edgeList.map(([u, v, w]) => Math.max(u, v, w)), 1);
  const mc = new MatchingComputer(DynamicUint.from(maxW));
  for (let index = 0; index < vertexCount; index++) mc.addVertex();
  for (const [u, v, w] of edgeList) {
    mc.setEdgeWeight(u, v, DynamicUint.from(w));
  }
  mc.computeMatching();
  return normalizeMatching(mc.getMatching());
}

describe('MatchingComputer', () => {
  describe('constructor and addVertex', () => {
    it('starts with zero vertices', () => {
      const mc = new MatchingComputer(DynamicUint.from(100));
      expect(mc.size).toBe(0);
    });

    it('addVertex increments size', () => {
      const mc = new MatchingComputer(DynamicUint.from(100));
      mc.addVertex();
      mc.addVertex();
      expect(mc.size).toBe(2);
    });
  });

  describe('integration: matches maxWeightMatching results', () => {
    it('4 vertices, 2 disjoint edges — unique optimal', () => {
      // Edge 0-1 weight 10, edge 2-3 weight 10. Optimal: both matched.
      const edgeList: [number, number, number][] = [
        [0, 1, 10],
        [2, 3, 10],
      ];
      const reference = maxWeightMatching(
        edgeList.map(([u, v, w]) => [u, v, DynamicUint.from(w)]),
      );
      const result = computeViaMatchingComputer(4, edgeList);
      expect(result).toEqual(reference);
    });

    it('4 vertices, complete graph — single optimal pair wins', () => {
      // Strongest edge is 0-3 (weight 20); optimal leaves 1-2 matched (weight 5)
      // or 0-3 with 1 and 2 unmatched. maxWeightMatching picks 0-3 + 1-2.
      const edgeList: [number, number, number][] = [
        [0, 1, 5],
        [0, 2, 5],
        [0, 3, 20],
        [1, 2, 5],
        [1, 3, 5],
        [2, 3, 5],
      ];
      const reference = maxWeightMatching(
        edgeList.map(([u, v, w]) => [u, v, DynamicUint.from(w)]),
      );
      const result = computeViaMatchingComputer(4, edgeList);
      expect(result).toEqual(reference);
    });

    it('6 vertices, path graph — unique perfect matching', () => {
      // Path 0-1-2-3-4-5, all weight 10. Optimal: (0,1),(2,3),(4,5).
      const edgeList: [number, number, number][] = [
        [0, 1, 10],
        [1, 2, 10],
        [2, 3, 10],
        [3, 4, 10],
        [4, 5, 10],
      ];
      const reference = maxWeightMatching(
        edgeList.map(([u, v, w]) => [u, v, DynamicUint.from(w)]),
      );
      const result = computeViaMatchingComputer(6, edgeList);
      // Both should produce the same total weight even if vertex ordering differs.
      const edgeWeightMap = new Map<string, number>();
      for (const [u, v, w] of edgeList) {
        const key = u < v ? `${u}-${v}` : `${v}-${u}`;
        edgeWeightMap.set(key, w);
      }
      expect(totalWeight(result, edgeWeightMap)).toBe(
        totalWeight(reference, edgeWeightMap),
      );
    });

    it('8 vertices, assorted weights — total weight equals maxWeightMatching', () => {
      const edgeList: [number, number, number][] = [
        [0, 1, 30],
        [0, 2, 15],
        [1, 3, 20],
        [2, 3, 25],
        [4, 5, 35],
        [4, 6, 10],
        [5, 7, 15],
        [6, 7, 40],
        [3, 4, 5],
      ];
      const reference = maxWeightMatching(
        edgeList.map(([u, v, w]) => [u, v, DynamicUint.from(w)]),
      );
      const result = computeViaMatchingComputer(8, edgeList);

      const edgeWeightMap = new Map<string, number>();
      for (const [u, v, w] of edgeList) {
        const key = u < v ? `${u}-${v}` : `${v}-${u}`;
        edgeWeightMap.set(key, w);
      }
      expect(totalWeight(result, edgeWeightMap)).toBe(
        totalWeight(reference, edgeWeightMap),
      );
    });
  });

  describe('persistence test', () => {
    it('preserves matching after unrelated setEdgeWeight', () => {
      const mc = new MatchingComputer(DynamicUint.from(100));
      for (let index = 0; index < 4; index++) mc.addVertex();
      mc.setEdgeWeight(0, 1, DynamicUint.from(50));
      mc.setEdgeWeight(2, 3, DynamicUint.from(50));
      mc.computeMatching();
      expect(mc.getMatching()).toEqual([1, 0, 3, 2]);

      // Modify edge 0-2 (unrelated to existing pairs).
      mc.setEdgeWeight(0, 2, DynamicUint.from(5));
      mc.computeMatching();
      // Original pairs should be preserved (not rearranged).
      expect(mc.getMatching()).toEqual([1, 0, 3, 2]);
    });
  });
});
