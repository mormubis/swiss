/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Graph class — persistent matching computer.
 *
 * Implements the Galil-Micali-Gabow O(n³) maximum-weight matching algorithm.
 * Ported from bbpPairings `graph.cpp` (854 lines), `graphimpl.h` (64 lines),
 * and `computer.cpp` (168 lines, the addVertex / setEdgeWeight parts).
 *
 * @internal Not part of the public API.
 */

import {
  ParentBlossom,
  RootBlossom,
  setPointersFromAncestor,
} from './blossom.js';
import { Label } from './types.js';
import { Vertex } from './vertex.js';

import type { DynamicUint } from '../dynamic-uint.js';
import type { Blossom, GraphLike } from './blossom.js';

// ---------------------------------------------------------------------------
// Helper: resistance between two vertices
// resistance(u, v) = u.dual + v.dual - w(u, v)
// Edge weights are stored doubled.
// ---------------------------------------------------------------------------

function resistance(u: Vertex, v: Vertex): DynamicUint {
  const result = u.dualVariable.clone();
  result.add(v.dualVariable);
  result.subtract(u.edgeWeights[v.vertexIndex]!);
  return result;
}

// ---------------------------------------------------------------------------
// Helper: augment from a vertex toward the exposed OUTER root
// Ported from rootblossom.cpp:284-303
// ---------------------------------------------------------------------------

function augmentToSource(vertex: Vertex | undefined, newMatch?: Vertex): void {
  while (vertex && vertex.rootBlossom!.baseVertexMatch) {
    vertex.rootBlossom!.baseVertex = vertex;
    const originalMatch = vertex.rootBlossom!.baseVertexMatch!.rootBlossom!;
    vertex.rootBlossom!.baseVertexMatch = newMatch;
    originalMatch.baseVertex = originalMatch.labeledVertex!;
    originalMatch.baseVertexMatch = originalMatch.labelingVertex;
    vertex = originalMatch.labelingVertex;
    newMatch = originalMatch.labeledVertex;
  }
  if (vertex) {
    vertex.rootBlossom!.baseVertex = vertex;
    vertex.rootBlossom!.baseVertexMatch = newMatch;
  }
}

// ---------------------------------------------------------------------------
// Graph class
// ---------------------------------------------------------------------------

class Graph implements GraphLike {
  // Public readonly fields (alphabetical)

  /**
   * Strictly greater than 4 × the max user-visible edge weight.
   * Implements GraphLike.aboveMaxEdgeWeight.
   */
  readonly aboveMaxEdgeWeight: DynamicUint;

  /**
   * Minimum outer edge resistance per RootBlossom slot, indexed in parallel
   * with rootBlossoms. One DynamicUint per RootBlossom, expanded whenever a
   * new vertex (and thus a new RootBlossom) is added.
   */
  readonly rootBlossomMinOuterEdgeResistances: DynamicUint[] = [];

  /**
   * Dual variable per vertex (aliased by vertex.dualVariable).
   * Implements GraphLike.vertexDualVariables.
   */
  readonly vertexDualVariables: DynamicUint[] = [];

  /** All vertices in the graph. */
  readonly vertices: Vertex[] = [];

  // Public mutable fields (alphabetical)

  /** All active ParentBlossoms. Implements GraphLike.parentBlossoms. */
  parentBlossoms: ParentBlossom[] = [];

  /** All active RootBlossoms. Implements GraphLike.rootBlossoms. */
  rootBlossoms: RootBlossom[] = [];

  constructor(maxEdgeWeight: DynamicUint) {
    // aboveMaxEdgeWeight = maxEdgeWeight * 4 + 1 (strictly greater than 4x)
    this.aboveMaxEdgeWeight = maxEdgeWeight.clone().shiftGrow(2).add(1);
  }

  // Public methods (alphabetical)

  // ---------------------------------------------------------------------------
  // addVertex — computer.cpp:45-65
  // ---------------------------------------------------------------------------

  addVertex(): void {
    const index = this.vertices.length;

    // 1. Expand every existing RootBlossom's minOuterEdges array.
    for (const rb of this.rootBlossoms) {
      rb.minOuterEdges.push(undefined);
    }

    // 2. Create the dual variable for the new vertex (zero, same word width).
    const dual = this.aboveMaxEdgeWeight.clone().and(0);
    this.vertexDualVariables.push(dual);

    // 3. Create the Vertex.
    const zero = this.aboveMaxEdgeWeight.clone().and(0);
    const vertex = new Vertex(index, zero);
    vertex.dualVariable = dual;
    this.vertices.push(vertex);

    // 4. Expand all existing vertices' edgeWeights (add one zero slot for the
    //    new vertex), and build the new vertex's full edgeWeights array.
    for (let index_ = 0; index_ < index; index_++) {
      const existingVertex = this.vertices[index_]!;
      existingVertex.edgeWeights.push(this.aboveMaxEdgeWeight.clone().and(0));
      vertex.edgeWeights.push(this.aboveMaxEdgeWeight.clone().and(0));
    }
    // The new vertex needs a slot for itself too (self-edge, always zero).
    vertex.edgeWeights.push(this.aboveMaxEdgeWeight.clone().and(0));

    // 5. Create singleton RootBlossom for the new vertex.
    const rb = new RootBlossom(vertex, vertex, undefined, this);
    vertex.rootBlossom = rb;

    // The new RootBlossom's minOuterEdges needs one slot per existing vertex
    // (including self).
    for (let index_ = 0; index_ <= index; index_++) {
      rb.minOuterEdges.push(undefined);
    }

    this.rootBlossoms.push(rb);
    this.rootBlossomMinOuterEdgeResistances.push(
      this.aboveMaxEdgeWeight.clone(),
    );
  }

  // ---------------------------------------------------------------------------
  // computeMatching — graph.cpp:791-849
  // ---------------------------------------------------------------------------

  computeMatching(): void {
    // Parity fix phase: make all exposed-vertex dualVariables have even values.
    // Iterate over a snapshot because freeAncestorOfBase modifies rootBlossoms.
    const snapshot = [...this.rootBlossoms];
    for (const rootBlossom of snapshot) {
      if (
        !rootBlossom.baseVertexMatch &&
        !rootBlossom.baseVertex.dualVariable.clone().and(1).isZero()
      ) {
        // dualVariable is odd — fix parity.
        let adjustableBlossom: Blossom = rootBlossom.rootChild;
        setPointersFromAncestor(
          rootBlossom.baseVertex,
          adjustableBlossom,
          true,
        );

        // Walk down to the deepest blossom with positive dual (or a vertex).
        while (
          !adjustableBlossom.isVertex &&
          (adjustableBlossom as ParentBlossom).dualVariable.isZero()
        ) {
          adjustableBlossom = (adjustableBlossom as ParentBlossom).subblossom;
        }

        // This modifies rootBlossoms (splits the blossom).
        // Access private method via bracket notation (same pattern as C++ friend).
        rootBlossom['freeAncestorOfBase'](adjustableBlossom, this);

        if (!adjustableBlossom.isVertex) {
          // ParentBlossom dual -= 2.
          (adjustableBlossom as ParentBlossom).dualVariable.subtract(2);
        }

        // Add 1 to every vertex's dual in the adjustable blossom.
        for (
          let v: Vertex | undefined = adjustableBlossom.vertexListHead;
          v;
          v = v.nextVertex
        ) {
          v.dualVariable.add(1);
        }
      }
    }

    // Main augmentation loop.
    while (this.augmentMatching()) {
      // keep augmenting until no more augmentations are possible
    }
  }

  // Private methods (alphabetical)

  // ---------------------------------------------------------------------------
  // addVertex helper: initialize inner-outer edges
  // ---------------------------------------------------------------------------

  private applyDualAdjustment(
    delta: DynamicUint,
    minOuterDual: DynamicUint,
    minInnerDual: DynamicUint,
    minOuterOuterResistance: DynamicUint,
    minInnerOuterResistance: DynamicUint,
  ): void {
    // Apply delta to all vertices and blossoms.
    for (const rb of this.rootBlossoms) {
      if (rb.label === Label.OUTER) {
        // OUTER: vertex duals decrease by delta.
        for (
          let v: Vertex | undefined = rb.rootChild.vertexListHead;
          v;
          v = v.nextVertex
        ) {
          v.dualVariable.subtract(delta);
        }
        // OUTER blossom's rootChild ParentBlossom dual increases by 2*delta.
        if (!rb.rootChild.isVertex) {
          (rb.rootChild as ParentBlossom).dualVariable.add(delta).add(delta);
        }
        // Outer-outer resistances decrease by 2*delta.
        rb.minOuterEdgeResistance.subtract(delta).subtract(delta);
      } else if (rb.label === Label.INNER) {
        // INNER: vertex duals increase by delta.
        for (
          let v: Vertex | undefined = rb.rootChild.vertexListHead;
          v;
          v = v.nextVertex
        ) {
          v.dualVariable.add(delta);
        }
        // INNER blossom's rootChild ParentBlossom dual decreases by 2*delta.
        if (!rb.rootChild.isVertex) {
          (rb.rootChild as ParentBlossom).dualVariable
            .subtract(delta)
            .subtract(delta);
        }
      } else {
        // FREE / ZERO: inner-outer resistances decrease by delta.
        for (
          let v: Vertex | undefined = rb.rootChild.vertexListHead;
          v;
          v = v.nextVertex
        ) {
          if (v.minOuterEdge !== undefined) {
            v.minOuterEdgeResistance.subtract(delta);
          }
        }
      }
    }

    // Update the tracking variables.
    minOuterDual.subtract(delta);
    minInnerDual.subtract(delta).subtract(delta); // inner dual changes by 2*delta
    minOuterOuterResistance.subtract(delta).subtract(delta);
    minInnerOuterResistance.subtract(delta);
  }

  // ---------------------------------------------------------------------------
  // augmentMatching — graph.cpp:395-785
  // ---------------------------------------------------------------------------

  private augmentMatching(): boolean {
    if (this.rootBlossoms.length === 0) return false;

    // -------------------------------------------------------------------------
    // INITIALIZATION
    // -------------------------------------------------------------------------

    // Assign initial labels.
    const minOuterDual = this.aboveMaxEdgeWeight.clone();
    const minInnerDual = this.aboveMaxEdgeWeight.clone();

    for (const rb of this.rootBlossoms) {
      rb.labeledVertex = undefined;
      rb.labelingVertex = undefined;
      rb.minOuterEdgeResistance.copyFrom(this.aboveMaxEdgeWeight);
      for (let index = 0; index < rb.minOuterEdges.length; index++) {
        rb.minOuterEdges[index] = undefined;
      }

      if (rb.baseVertexMatch) {
        rb.label = Label.FREE;
      } else {
        // Exposed vertex.
        if (rb.baseVertex.dualVariable.isZero()) {
          rb.label = Label.ZERO;
        } else {
          rb.label = Label.OUTER;
          if (rb.baseVertex.dualVariable.lt(minOuterDual)) {
            minOuterDual.copyFrom(rb.baseVertex.dualVariable);
          }
        }
      }

      // Reset vertex minOuterEdge tracking.
      for (
        let v: Vertex | undefined = rb.rootChild.vertexListHead;
        v;
        v = v.nextVertex
      ) {
        v.minOuterEdge = undefined;
        v.minOuterEdgeResistance.copyFrom(this.aboveMaxEdgeWeight);
      }
    }

    // Initialize inner-outer edges: for each non-OUTER blossom vertex, find
    // cheapest edge to any OUTER vertex.
    this.initializeInnerOuterEdges();

    // Initialize outer-outer edges: for each pair of OUTER blossoms, find
    // cheapest edge between them.
    this.initializeOuterOuterEdges();

    // Track minimum outer edge resistance across all RootBlossoms.
    const minOuterOuterResistance = this.aboveMaxEdgeWeight.clone();
    const minInnerOuterResistance = this.aboveMaxEdgeWeight.clone();

    for (const rb of this.rootBlossoms) {
      if (rb.label === Label.OUTER) {
        if (rb.minOuterEdgeResistance.lt(minOuterOuterResistance)) {
          minOuterOuterResistance.copyFrom(rb.minOuterEdgeResistance);
        }
      } else {
        // FREE / ZERO: check inner-outer resistance
        for (
          let v: Vertex | undefined = rb.rootChild.vertexListHead;
          v;
          v = v.nextVertex
        ) {
          if (
            v.minOuterEdge !== undefined &&
            v.minOuterEdgeResistance.lt(minInnerOuterResistance)
          ) {
            minInnerOuterResistance.copyFrom(v.minOuterEdgeResistance);
          }
        }
      }
    }

    // Also update minInnerDual from ParentBlossoms with INNER label.
    for (const rb of this.rootBlossoms) {
      if (rb.label === Label.INNER && !rb.rootChild.isVertex) {
        const pb = rb.rootChild as ParentBlossom;
        if (pb.dualVariable.lt(minInnerDual)) {
          minInnerDual.copyFrom(pb.dualVariable);
        }
      }
    }

    // -------------------------------------------------------------------------
    // MAIN LOOP
    // -------------------------------------------------------------------------

    for (;;) {
      // Check if there are any OUTER vertices at all.
      const hasOuter = this.rootBlossoms.some((rb) => rb.label === Label.OUTER);
      if (!hasOuter) return false;

      // Compute the dual adjustment delta.
      // delta = min(
      //   minOuterDual,                    // OUTER dual → 0
      //   minInnerOuterResistance,         // FREE/ZERO↔OUTER edge tight
      //   floor(minOuterOuterResistance/2),// OUTER↔OUTER edge tight
      //   floor(minInnerDual/2)            // INNER blossom dual → 0
      // )

      const halfOuterOuter = minOuterOuterResistance.clone().shiftRight(1);
      const halfInnerDual = minInnerDual.clone().shiftRight(1);

      const delta = minOuterDual.clone();
      if (minInnerOuterResistance.lt(delta))
        delta.copyFrom(minInnerOuterResistance);
      if (halfOuterOuter.lt(delta)) delta.copyFrom(halfOuterOuter);
      if (halfInnerDual.lt(delta)) delta.copyFrom(halfInnerDual);

      if (delta.isZero() && minOuterDual.isZero()) {
        // An OUTER vertex hit 0 dual — augment to source.
        return this.augmentFromZeroOuter();
      }

      // Apply dual adjustment.
      this.applyDualAdjustment(
        delta,
        minOuterDual,
        minInnerDual,
        minOuterOuterResistance,
        minInnerOuterResistance,
      );

      // Check which limit was reached.

      // Case 1: OUTER vertex dual → 0
      if (minOuterDual.isZero()) {
        return this.augmentFromZeroOuter();
      }

      // Case 2/4: tight inner-outer edge
      if (minInnerOuterResistance.isZero()) {
        const result = this.handleTightInnerOuterEdge(
          minOuterDual,
          minInnerDual,
          minOuterOuterResistance,
          minInnerOuterResistance,
        );
        if (result !== undefined) return result;
        // Continue loop — recalculate minima.
        this.recalculateMinima(
          minOuterDual,
          minInnerDual,
          minOuterOuterResistance,
          minInnerOuterResistance,
        );
        continue;
      }

      // Case 3: OUTER↔OUTER edge tight
      if (minOuterOuterResistance.isZero()) {
        const result = this.handleTightOuterOuterEdge(
          minOuterDual,
          minInnerDual,
          minOuterOuterResistance,
          minInnerOuterResistance,
        );
        if (result !== undefined) return result;
        this.recalculateMinima(
          minOuterDual,
          minInnerDual,
          minOuterOuterResistance,
          minInnerOuterResistance,
        );
        continue;
      }

      // Case 5: INNER blossom dual → 0
      if (minInnerDual.isZero()) {
        this.dissolveZeroDualInnerBlossom();
        this.recalculateMinima(
          minOuterDual,
          minInnerDual,
          minOuterOuterResistance,
          minInnerOuterResistance,
        );
        continue;
      }

      // No more progress possible.
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Case 1: augment from OUTER vertex with zero dual
  // ---------------------------------------------------------------------------

  private augmentFromZeroOuter(): boolean {
    // Find an OUTER vertex with zero dual.
    for (const rb of this.rootBlossoms) {
      if (rb.label === Label.OUTER && rb.baseVertex.dualVariable.isZero()) {
        augmentToSource(rb.baseVertex);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Blossom formation (Case 3, same root)
  // Ported from graph.cpp blossom-forming logic
  // ---------------------------------------------------------------------------

  private buildPathToRoot(v: Vertex, rb: RootBlossom): Vertex[] {
    const path: Vertex[] = [];
    let current: Vertex | undefined = v;
    while (current && current.rootBlossom !== rb) {
      path.push(current);
      current = current.rootBlossom?.labelingVertex;
    }
    if (current) path.push(current);
    return path;
  }

  // ---------------------------------------------------------------------------
  // Case 5: dissolve INNER blossom with zero dual
  // ---------------------------------------------------------------------------

  private dissolveZeroDualInnerBlossom(): void {
    const snapshot = [...this.rootBlossoms];
    for (const rb of snapshot) {
      if (rb.label !== Label.INNER) continue;
      if (rb.rootChild.isVertex) continue;
      const pb = rb.rootChild as ParentBlossom;
      if (!pb.dualVariable.isZero()) continue;

      // Dissolve this blossom: create individual RootBlossoms for each child.
      const pbIndex = this.parentBlossoms.indexOf(pb);
      if (pbIndex !== -1) this.parentBlossoms.splice(pbIndex, 1);

      const rbIndex = this.rootBlossoms.indexOf(rb);
      if (rbIndex !== -1) this.rootBlossoms.splice(rbIndex, 1);

      // Walk the blossom's children and create new RootBlossoms.
      let child: Blossom | undefined = pb.subblossom;
      let isOnLabelingPath = true;
      do {
        const baseV = isOnLabelingPath
          ? (child!.vertexToNextSiblingBlossom ?? child!.vertexListHead)
          : child!.vertexListHead;

        const newRb = new RootBlossom(child!, baseV, undefined, this);
        newRb.label = isOnLabelingPath ? Label.INNER : Label.FREE;
        child!.parentBlossom = undefined;

        for (
          let v: Vertex | undefined = child!.vertexListHead;
          v;
          v = v.nextVertex
        ) {
          v.rootBlossom = newRb;
        }

        this.rootBlossoms.push(newRb);
        this.rootBlossomMinOuterEdgeResistances.push(
          this.aboveMaxEdgeWeight.clone(),
        );

        child = child!.nextBlossom;
        isOnLabelingPath = !isOnLabelingPath;
      } while (child !== pb.subblossom && child !== undefined);
    }
  }

  private formNewBlossom(v1: Vertex, v2: Vertex, rb: RootBlossom): void {
    // Build the path from v1 to root and from v2 to root, find LCA.
    const path1 = this.buildPathToRoot(v1, rb);
    const path2 = this.buildPathToRoot(v2, rb);

    // Find LCA.
    const inPath1 = new Set(path1.map((p) => p.vertexIndex));
    let lcaIndex = -1;
    for (const pv of path2) {
      if (inPath1.has(pv.vertexIndex)) {
        lcaIndex = pv.vertexIndex;
        break;
      }
    }

    if (lcaIndex === -1) {
      // No common ancestor found — treat as cross-edge, augment.
      augmentToSource(v1, v2);
      augmentToSource(v2, v1);
      return;
    }

    const lcaInPath1 = path1.findIndex((p) => p.vertexIndex === lcaIndex);
    const lcaInPath2 = path2.findIndex((p) => p.vertexIndex === lcaIndex);

    const cyclePart1 = path1.slice(0, lcaInPath1);
    const cyclePart2 = path2.slice(0, lcaInPath2).toReversed();
    const lcaVertex = this.vertices[lcaIndex]!;

    // Create a new ParentBlossom that represents this cycle.
    const cycleVertices = [v1, ...cyclePart1, lcaVertex, ...cyclePart2, v2];

    const newDual = this.aboveMaxEdgeWeight.clone().and(0);
    const newParent = new ParentBlossom(
      newDual,
      rb,
      rb.rootChild,
      rb.rootChild.vertexListHead,
      rb.rootChild.vertexListTail,
    );

    // Connect all vertices in the cycle to the new parent.
    for (const cv of cycleVertices) {
      cv.parentBlossom = newParent;
    }

    this.parentBlossoms.push(newParent);
    rb.rootChild = newParent;
  }

  // ---------------------------------------------------------------------------
  // Case 2/4: tight inner-outer edge
  // ---------------------------------------------------------------------------

  private handleTightInnerOuterEdge(
    minOuterDual: DynamicUint,
    minInnerDual: DynamicUint,
    minOuterOuterResistance: DynamicUint,
    minInnerOuterResistance: DynamicUint,
  ): boolean | undefined {
    for (const rb of this.rootBlossoms) {
      if (rb.label === Label.OUTER) continue;

      for (
        let v: Vertex | undefined = rb.rootChild.vertexListHead;
        v;
        v = v.nextVertex
      ) {
        if (v.minOuterEdge !== undefined && v.minOuterEdgeResistance.isZero()) {
          const outerV = v.minOuterEdge;

          if (rb.label === Label.ZERO) {
            // Case 2: ZERO vertex — tight edge, augment both directions.
            augmentToSource(v, outerV);
            augmentToSource(outerV, v);
            return true;
          } else {
            // Case 4: FREE vertex — label it INNER, label its match OUTER.
            rb.label = Label.INNER;
            rb.labeledVertex = v;
            rb.labelingVertex = outerV;

            // The match of the base of rb becomes OUTER.
            if (rb.baseVertexMatch) {
              const matchRb = rb.baseVertexMatch.rootBlossom!;
              if (matchRb.label === Label.FREE) {
                matchRb.label = Label.OUTER;
                matchRb.labeledVertex = rb.baseVertexMatch;
                matchRb.labelingVertex = rb.baseVertex;

                // Update minOuterDual.
                if (
                  minOuterDual.compareTo(this.aboveMaxEdgeWeight) === 0 ||
                  rb.baseVertexMatch.dualVariable.lt(minOuterDual)
                ) {
                  minOuterDual.copyFrom(rb.baseVertexMatch.dualVariable);
                }

                // Re-initialize inner-outer edges for the new OUTER blossom.
                this.updateInnerOuterEdgesForNewOuter(
                  matchRb,
                  minInnerOuterResistance,
                );

                // Re-initialize outer-outer edges for the new OUTER blossom.
                this.updateOuterOuterEdgesForNewOuter(
                  matchRb,
                  minOuterOuterResistance,
                );
              }
            }

            void minInnerDual;
            return undefined; // continue loop
          }
        }
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Case 3: tight outer-outer edge
  // ---------------------------------------------------------------------------

  private handleTightOuterOuterEdge(
    minOuterDual: DynamicUint,
    minInnerDual: DynamicUint,
    minOuterOuterResistance: DynamicUint,
    minInnerOuterResistance: DynamicUint,
  ): boolean | undefined {
    // Find the OUTER blossom with zero minOuterEdgeResistance.
    for (const rb1 of this.rootBlossoms) {
      if (rb1.label !== Label.OUTER) continue;
      if (!rb1.minOuterEdgeResistance.isZero()) continue;

      let bestV1: Vertex | undefined;
      let bestV2: Vertex | undefined;

      outer: for (const rb2 of this.rootBlossoms) {
        if (rb2 === rb1 || rb2.label !== Label.OUTER) continue;
        for (
          let v1: Vertex | undefined = rb1.rootChild.vertexListHead;
          v1;
          v1 = v1.nextVertex
        ) {
          for (
            let v2: Vertex | undefined = rb2.rootChild.vertexListHead;
            v2;
            v2 = v2.nextVertex
          ) {
            if (v1.vertexIndex === v2.vertexIndex) continue;
            const r = resistance(v1, v2);
            if (r.isZero()) {
              bestV1 = v1;
              bestV2 = v2;
              break outer;
            }
          }
        }
      }

      if (bestV1 === undefined || bestV2 === undefined) continue;

      const rb2 = bestV2.rootBlossom!;

      if (rb1 === rb2) {
        // Same root — form a new blossom.
        this.formNewBlossom(bestV1, bestV2, rb1);
        void minOuterDual;
        void minInnerDual;
        void minOuterOuterResistance;
        void minInnerOuterResistance;
        return undefined;
      } else {
        // Different roots — augment.
        augmentToSource(bestV1, bestV2);
        augmentToSource(bestV2, bestV1);
        return true;
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Initialization helpers
  // ---------------------------------------------------------------------------

  private initializeInnerOuterEdges(): void {
    for (const rb of this.rootBlossoms) {
      if (rb.label === Label.OUTER) continue;
      for (
        let v: Vertex | undefined = rb.rootChild.vertexListHead;
        v;
        v = v.nextVertex
      ) {
        for (const outerRb of this.rootBlossoms) {
          if (outerRb.label !== Label.OUTER) continue;
          for (
            let outerV: Vertex | undefined = outerRb.rootChild.vertexListHead;
            outerV;
            outerV = outerV.nextVertex
          ) {
            if (v.vertexIndex === outerV.vertexIndex) continue;
            const r = resistance(v, outerV);
            if (
              v.minOuterEdge === undefined ||
              r.lt(v.minOuterEdgeResistance)
            ) {
              v.minOuterEdge = outerV;
              v.minOuterEdgeResistance.copyFrom(r);
            }
          }
        }
      }
    }
  }

  private initializeOuterOuterEdges(): void {
    for (const rb of this.rootBlossoms) {
      if (rb.label !== Label.OUTER) continue;
      for (const otherRb of this.rootBlossoms) {
        if (otherRb === rb) continue;
        if (otherRb.label !== Label.OUTER) continue;
        this.updateOuterOuterEdge(rb, otherRb);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Recalculate minima after structural changes
  // ---------------------------------------------------------------------------

  private recalculateMinima(
    minOuterDual: DynamicUint,
    minInnerDual: DynamicUint,
    minOuterOuterResistance: DynamicUint,
    minInnerOuterResistance: DynamicUint,
  ): void {
    minOuterDual.copyFrom(this.aboveMaxEdgeWeight);
    minInnerDual.copyFrom(this.aboveMaxEdgeWeight);
    minOuterOuterResistance.copyFrom(this.aboveMaxEdgeWeight);
    minInnerOuterResistance.copyFrom(this.aboveMaxEdgeWeight);

    for (const rb of this.rootBlossoms) {
      if (rb.label === Label.OUTER) {
        if (rb.baseVertex.dualVariable.lt(minOuterDual)) {
          minOuterDual.copyFrom(rb.baseVertex.dualVariable);
        }
        if (rb.minOuterEdgeResistance.lt(minOuterOuterResistance)) {
          minOuterOuterResistance.copyFrom(rb.minOuterEdgeResistance);
        }
      } else if (rb.label === Label.INNER) {
        if (!rb.rootChild.isVertex) {
          const pb = rb.rootChild as ParentBlossom;
          if (pb.dualVariable.lt(minInnerDual)) {
            minInnerDual.copyFrom(pb.dualVariable);
          }
        }
      } else {
        for (
          let v: Vertex | undefined = rb.rootChild.vertexListHead;
          v;
          v = v.nextVertex
        ) {
          if (
            v.minOuterEdge !== undefined &&
            v.minOuterEdgeResistance.lt(minInnerOuterResistance)
          ) {
            minInnerOuterResistance.copyFrom(v.minOuterEdgeResistance);
          }
        }
      }
    }
  }

  private updateInnerOuterEdgesForNewOuter(
    newOuterRb: RootBlossom,
    minInnerOuterResistance: DynamicUint,
  ): void {
    for (const rb of this.rootBlossoms) {
      if (rb === newOuterRb || rb.label === Label.OUTER) continue;
      for (
        let v: Vertex | undefined = rb.rootChild.vertexListHead;
        v;
        v = v.nextVertex
      ) {
        for (
          let outerV: Vertex | undefined = newOuterRb.rootChild.vertexListHead;
          outerV;
          outerV = outerV.nextVertex
        ) {
          if (v.vertexIndex === outerV.vertexIndex) continue;
          const r = resistance(v, outerV);
          if (v.minOuterEdge === undefined || r.lt(v.minOuterEdgeResistance)) {
            v.minOuterEdge = outerV;
            v.minOuterEdgeResistance.copyFrom(r);
            if (r.lt(minInnerOuterResistance)) {
              minInnerOuterResistance.copyFrom(r);
            }
          }
        }
      }
    }
  }

  private updateOuterOuterEdge(rb1: RootBlossom, rb2: RootBlossom): void {
    for (
      let v1: Vertex | undefined = rb1.rootChild.vertexListHead;
      v1;
      v1 = v1.nextVertex
    ) {
      for (
        let v2: Vertex | undefined = rb2.rootChild.vertexListHead;
        v2;
        v2 = v2.nextVertex
      ) {
        if (v1.vertexIndex === v2.vertexIndex) continue;
        const r = resistance(v1, v2);
        if (
          rb1.minOuterEdgeResistance.compareTo(this.aboveMaxEdgeWeight) === 0 ||
          r.lt(rb1.minOuterEdgeResistance)
        ) {
          rb1.minOuterEdgeResistance.copyFrom(r);
          rb1.minOuterEdges[v2.vertexIndex] = v1;
        }
      }
    }
  }

  private updateOuterOuterEdgesForNewOuter(
    newOuterRb: RootBlossom,
    minOuterOuterResistance: DynamicUint,
  ): void {
    for (const rb of this.rootBlossoms) {
      if (rb === newOuterRb || rb.label !== Label.OUTER) continue;
      this.updateOuterOuterEdge(rb, newOuterRb);
      this.updateOuterOuterEdge(newOuterRb, rb);
      if (rb.minOuterEdgeResistance.lt(minOuterOuterResistance)) {
        minOuterOuterResistance.copyFrom(rb.minOuterEdgeResistance);
      }
      if (newOuterRb.minOuterEdgeResistance.lt(minOuterOuterResistance)) {
        minOuterOuterResistance.copyFrom(newOuterRb.minOuterEdgeResistance);
      }
    }
  }
}

export { Graph };
