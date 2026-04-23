/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * MatchingComputer — thin facade over Graph for persistent maximum-weight
 * matching.
 *
 * Mirrors the public API of bbpPairings `Computer` (computer.cpp, 168 lines).
 * The Graph class implements the core Galil-Micali-Gabow algorithm; this class
 * handles:
 *
 * - Edge-weight doubling (user provides weight W; stored internally as 2W).
 * - `prepareVertexForWeightAdjustments` on edge-weight updates (dissolves
 *   stale blossoms, resets dual variables).
 * - Calling `putVerticesInMatchingOrder` after `computeMatching` so that
 *   `getMatching` can read matched pairs consecutively.
 * - Extracting the matching result from RootBlossom vertex lists.
 *
 * @internal Not part of the public API.
 */

import { Graph } from './matching/graph.js';

import type { DynamicUint } from './dynamic-uint.js';

class MatchingComputer {
  private readonly graph: Graph;

  constructor(maxEdgeWeight: DynamicUint) {
    this.graph = new Graph(maxEdgeWeight);
  }

  get size(): number {
    return this.graph.vertices.length;
  }

  addVertex(): void {
    this.graph.addVertex();
  }

  computeMatching(): void {
    this.graph.computeMatching();
    for (const rb of this.graph.rootBlossoms) {
      rb.putVerticesInMatchingOrder();
    }
  }

  /**
   * Returns the matching as an array of length `size` where `result[i] = j`
   * means vertex `i` is matched to vertex `j`.
   *
   * Unmatched (exposed) vertices report `result[i] = i` (matched to self).
   *
   * Must be called after `computeMatching`.
   */
  getMatching(): number[] {
    const result = Array.from<number>({ length: this.size }).fill(-1);

    for (const rb of this.graph.rootBlossoms) {
      const baseIndex = rb.baseVertex.vertexIndex;

      result[baseIndex] = rb.baseVertexMatch
        ? rb.baseVertexMatch.vertexIndex
        : baseIndex; // Exposed vertex — report as matched to self.

      // Walk the vertex linked list (already in matching order after
      // putVerticesInMatchingOrder). Vertices after the base are in
      // consecutive matched pairs.
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

  setEdgeWeight(vertex: number, neighbor: number, weight: DynamicUint): void {
    // Internally weights are stored doubled (2W) to keep dual arithmetic
    // integral. Left-shift by 1 is equivalent to multiply by 2.
    const doubled = weight.clone().shiftLeft(1);

    const v = this.graph.vertices[vertex]!;
    // Dissolve stale blossoms around this vertex and reset its dual variable.
    v.rootBlossom!.prepareVertexForWeightAdjustments(v, this.graph);

    const n = this.graph.vertices[neighbor]!;
    // Dissolve stale blossoms around the neighbor and reset its dual variable.
    // This clears any stale baseVertexMatch on the neighbor's root blossom,
    // preventing it from being incorrectly labeled FREE in the next
    // computeMatching when its prior match partner has been freed.
    n.rootBlossom!.prepareVertexForWeightAdjustments(n, this.graph);

    v.edgeWeights[neighbor] = doubled.clone();
    n.edgeWeights[vertex] = doubled.clone();
  }
}

export { MatchingComputer };
