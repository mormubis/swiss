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
  getAncestorOfVertex,
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

/**
 * Compute resistance into pre-allocated DynamicUint (zero allocation).
 * resistance(u, v) = u.dual + v.dual - w(u, v)
 */
function resistanceInto(out: DynamicUint, u: Vertex, v: Vertex): void {
  out.copyFrom(u.dualVariable);
  out.add(v.dualVariable);
  out.subtract(u.edgeWeights[v.vertexIndex]!);
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

  /** Pre-allocated scratch for resistance calculations. */
  private readonly resistanceStorage: DynamicUint;

  constructor(maxEdgeWeight: DynamicUint) {
    // aboveMaxEdgeWeight = maxEdgeWeight * 4 + 1 (strictly greater than 4x)
    this.aboveMaxEdgeWeight = maxEdgeWeight.clone().shiftGrow(2).add(1);
    this.resistanceStorage = this.aboveMaxEdgeWeight.clone();
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

  // ---------------------------------------------------------------------------
  // augmentMatching — graph.cpp:395-785
  // Complete rewrite to faithfully port the C++ algorithm.
  // ---------------------------------------------------------------------------

  private augmentMatching(): boolean {
    // -------------------------------------------------------------------------
    // INITIALIZATION (initializeLabeling)
    // -------------------------------------------------------------------------

    // minOuterDualVariable tracks the minimum dual among OUTER vertices,
    // plus the vertex that achieves it.
    const minOuterDualVariable = this.aboveMaxEdgeWeight.clone();
    let minOuterDualVariableVertex: Vertex | undefined;

    for (const rb of this.rootBlossoms) {
      // Reset labeling state.
      rb.labeledVertex = undefined;
      rb.labelingVertex = undefined;
      rb.minOuterEdgeResistance.copyFrom(this.aboveMaxEdgeWeight);
      for (let index = 0; index < rb.minOuterEdges.length; index++) {
        rb.minOuterEdges[index] = undefined;
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

      if (rb.baseVertexMatch) {
        rb.label = Label.FREE;
      } else {
        // Exposed vertex.
        if (rb.baseVertex.dualVariable.isZero()) {
          rb.label = Label.ZERO;
        } else {
          rb.label = Label.OUTER;
          // Track min outer dual variable vertex.
          if (rb.baseVertex.dualVariable.lt(minOuterDualVariable)) {
            minOuterDualVariable.copyFrom(rb.baseVertex.dualVariable);
            minOuterDualVariableVertex = rb.baseVertex;
          }
        }
      }
    }

    // If no OUTER vertices, no augmentation possible.
    if (!minOuterDualVariableVertex) {
      return false;
    }

    // -------------------------------------------------------------------------
    // Initialize inner-outer edges: for each non-OUTER blossom vertex, find
    // cheapest edge to any OUTER vertex.
    // (initializeInnerOuterEdges)
    // -------------------------------------------------------------------------
    this.initializeInnerOuterEdges();

    // -------------------------------------------------------------------------
    // Initialize outer-outer edges: for each OUTER blossom, find cheapest
    // edges to all other OUTER blossoms.
    // (initializeOuterOuterEdges)
    // -------------------------------------------------------------------------
    this.initializeOuterOuterEdges();

    // -------------------------------------------------------------------------
    // Initialize minOuterOuterEdgeResistance tracking
    // (initializeMinOuterOuterEdgeResistance)
    // -------------------------------------------------------------------------
    const minOuterOuterEdgeResistance = this.aboveMaxEdgeWeight.clone();
    let minOuterOuterEdgeResistanceRootBlossom: RootBlossom | undefined;
    for (const rb of this.rootBlossoms) {
      if (
        rb.label === Label.OUTER &&
        rb.minOuterEdgeResistance.lt(minOuterOuterEdgeResistance)
      ) {
        minOuterOuterEdgeResistance.copyFrom(rb.minOuterEdgeResistance);
        minOuterOuterEdgeResistanceRootBlossom = rb;
      }
    }

    // -------------------------------------------------------------------------
    // Initialize minInnerDualVariable tracking
    // -------------------------------------------------------------------------
    const minInnerDualVariable = this.aboveMaxEdgeWeight.clone();
    let minInnerDualVariableBlossom: ParentBlossom | undefined;
    this.initializeMinInnerDualVariable(
      (blossom) => {
        minInnerDualVariableBlossom = blossom;
      },
      (value) => {
        minInnerDualVariable.copyFrom(value);
      },
    );

    // -------------------------------------------------------------------------
    // MAIN LOOP
    // -------------------------------------------------------------------------

    for (;;) {
      // Compute minInnerOuterEdgeResistance FRESH each iteration (C++ does
      // this at top of loop every iteration).
      const minInnerOuterEdgeResistance = this.aboveMaxEdgeWeight.clone();
      let minInnerOuterEdgeResistanceVertex: Vertex | undefined;
      for (const vertex of this.vertices) {
        if (
          (vertex.rootBlossom!.label === Label.FREE ||
            vertex.rootBlossom!.label === Label.ZERO) &&
          vertex.minOuterEdgeResistance.lt(minInnerOuterEdgeResistance)
        ) {
          minInnerOuterEdgeResistance.copyFrom(vertex.minOuterEdgeResistance);
          minInnerOuterEdgeResistanceVertex = vertex;
        }
      }

      // Compute dual adjustment:
      // dualAdjustment = min(
      //   minOuterDualVariable,
      //   minInnerOuterEdgeResistance,
      //   minOuterOuterEdgeResistance >> 1,
      //   minInnerDualVariable >> 1
      // )
      const halfOuterOuter = minOuterOuterEdgeResistance.clone().shiftRight(1);
      const halfInnerDual = minInnerDualVariable.clone().shiftRight(1);

      const dualAdjustment = minOuterDualVariable.clone();
      if (minInnerOuterEdgeResistance.lt(dualAdjustment)) {
        dualAdjustment.copyFrom(minInnerOuterEdgeResistance);
      }
      if (halfOuterOuter.lt(dualAdjustment)) {
        dualAdjustment.copyFrom(halfOuterOuter);
      }
      if (halfInnerDual.lt(dualAdjustment)) {
        dualAdjustment.copyFrom(halfInnerDual);
      }

      // Apply dual adjustment (per-vertex, like C++).
      if (!dualAdjustment.isZero()) {
        const twiceAdjustment = dualAdjustment.clone().shiftLeft(1);

        // Update tracking variables.
        minOuterDualVariable.subtract(dualAdjustment);
        minInnerOuterEdgeResistance.subtract(dualAdjustment);
        minOuterOuterEdgeResistance.subtract(twiceAdjustment);
        minInnerDualVariable.subtract(twiceAdjustment);

        // Per-vertex adjustment (C++ iterates all vertices).
        for (const vertex of this.vertices) {
          const rootBlossom = vertex.rootBlossom!;
          const label = rootBlossom.label;

          if (label === Label.OUTER) {
            vertex.dualVariable.subtract(dualAdjustment);
          } else if (label === Label.INNER) {
            vertex.dualVariable.add(dualAdjustment);
          } else if (
            vertex.minOuterEdgeResistance.lt(this.aboveMaxEdgeWeight)
              ? true
              : false
          ) {
            // FREE or ZERO with a known min outer edge resistance:
            // check if it's not aboveMaxEdgeWeight
            vertex.minOuterEdgeResistance.subtract(dualAdjustment);
          }

          // Extra work done once per rootBlossom (when we're at the base vertex).
          if (rootBlossom.baseVertex === vertex) {
            if (label === Label.OUTER) {
              if (
                rootBlossom.minOuterEdgeResistance.lt(this.aboveMaxEdgeWeight)
              ) {
                rootBlossom.minOuterEdgeResistance.subtract(twiceAdjustment);
              }
              if (!rootBlossom.rootChild.isVertex) {
                (rootBlossom.rootChild as ParentBlossom).dualVariable.add(
                  twiceAdjustment,
                );
              }
            } else if (
              label === Label.INNER &&
              !rootBlossom.rootChild.isVertex
            ) {
              (rootBlossom.rootChild as ParentBlossom).dualVariable.subtract(
                twiceAdjustment,
              );
            }
          }
        }
      }

      // -----------------------------------------------------------------------
      // CASE 1: OUTER vertex dual → 0
      // -----------------------------------------------------------------------
      if (minOuterDualVariable.isZero()) {
        augmentToSource(minOuterDualVariableVertex);
        return true;
      }

      // -----------------------------------------------------------------------
      // CASE 2: ZERO↔OUTER tight edge
      // -----------------------------------------------------------------------
      if (
        minInnerOuterEdgeResistance.isZero() &&
        minInnerOuterEdgeResistanceVertex !== undefined &&
        minInnerOuterEdgeResistanceVertex.rootBlossom!.label === Label.ZERO
      ) {
        const zv = minInnerOuterEdgeResistanceVertex;
        augmentToSource(zv.minOuterEdge, zv);
        augmentToSource(zv, zv.minOuterEdge);
        return true;
      }

      // -----------------------------------------------------------------------
      // CASE 3: OUTER↔OUTER tight edge
      // -----------------------------------------------------------------------
      else if (minOuterOuterEdgeResistance.isZero()) {
        // Find the two vertices with zero resistance using minOuterEdges.
        // The C++ finds another OUTER rootBlossom != minOuterOuterEdgeResistanceRootBlossom
        // such that the edge between them is tight.
        let vertex0: Vertex | undefined;
        let vertex1: Vertex | undefined;

        const rb0 = minOuterOuterEdgeResistanceRootBlossom;
        if (rb0 !== undefined) {
          for (const rb1 of this.rootBlossoms) {
            if (rb1.label !== Label.OUTER || rb1 === rb0) continue;
            // rb0 stores in minOuterEdges[rb1.baseVertex.vertexIndex] the vertex
            // in rb0 closest to rb1.
            const v0 = rb0.minOuterEdges[rb1.baseVertex.vertexIndex];
            // rb1 stores in minOuterEdges[rb0.baseVertex.vertexIndex] the vertex
            // in rb1 closest to rb0.
            const v1 = rb1.minOuterEdges[rb0.baseVertex.vertexIndex];
            if (v0 !== undefined && v1 !== undefined) {
              resistanceInto(this.resistanceStorage, v0, v1);
              if (this.resistanceStorage.isZero()) {
                vertex0 = v0;
                vertex1 = v1;
                break;
              }
            }
          }
        }

        // If not found via tracked references, do a brute-force scan as fallback.
        if (vertex0 === undefined || vertex1 === undefined) {
          outerSearch: for (const rb1 of this.rootBlossoms) {
            if (rb1.label !== Label.OUTER) continue;
            for (const rb2 of this.rootBlossoms) {
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
                  resistanceInto(this.resistanceStorage, v1, v2);
                  if (this.resistanceStorage.isZero()) {
                    vertex0 = v1;
                    vertex1 = v2;
                    break outerSearch;
                  }
                }
              }
            }
          }
        }

        if (vertex0 === undefined || vertex1 === undefined) {
          // No tight edge found — shouldn't happen but guard anyway.
          return false;
        }

        // Build path using the C++ deque pattern (graph.cpp:573-589).
        // Each push_front/push_back uses the CURRENT front/back vertex,
        // which changes after every push.
        //
        // We use two arrays: pathFront grows leftward (unshift), pathBack
        // grows rightward (push). The final path is [...pathFront, ...pathBack].
        const pathFront: Vertex[] = [vertex0];
        const pathBack: Vertex[] = [vertex1];

        // Expand front toward its exposed root.
        while (pathFront[0]!.rootBlossom!.baseVertexMatch) {
          const front = pathFront[0]!;
          pathFront.unshift(front.rootBlossom!.baseVertex);
          pathFront.unshift(pathFront[0]!.rootBlossom!.baseVertexMatch!);
          pathFront.unshift(pathFront[0]!.rootBlossom!.labeledVertex!);
          pathFront.unshift(pathFront[0]!.rootBlossom!.labelingVertex!);
        }

        // Expand back toward its exposed root.
        while (pathBack.at(-1)!.rootBlossom!.baseVertexMatch) {
          const b0 = pathBack.at(-1)!.rootBlossom!.baseVertex;
          const b1 = b0.rootBlossom!.baseVertexMatch!;
          const b2 = b1.rootBlossom!.labeledVertex!;
          const b3 = b2.rootBlossom!.labelingVertex!;
          pathBack.push(b0, b1, b2, b3);
        }

        // Same-root check: compare the exposed roots at the path endpoints.
        // (C++ line 591: path.front()->rootBlossom == path.back()->rootBlossom)
        if (pathFront[0]!.rootBlossom === pathBack.at(-1)!.rootBlossom) {
          // SAME ROOT → form new blossom.

          // Trim shared prefix (C++ lines 594-606).
          // While the second element from each end shares a rootBlossom,
          // remove 4 from each end.
          while (
            pathFront.length >= 2 &&
            pathBack.length >= 2 &&
            pathFront[1]!.rootBlossom === pathBack.at(-2)!.rootBlossom
          ) {
            pathFront.splice(0, 4);
            pathBack.splice(-4, 4);
          }

          const path: Vertex[] = [...pathFront, ...pathBack];

          // Form a new blossom from this path.
          this.formBlossomFromPath(path);

          // After forming a new blossom, re-update tracking variables.
          const newRb = path[0]!.rootBlossom!;

          // Update minOuterDualVariable for vertices in new blossom.
          for (
            let v: Vertex | undefined = newRb.rootChild.vertexListHead;
            v;
            v = v.nextVertex
          ) {
            if (v.dualVariable.lt(minOuterDualVariable)) {
              minOuterDualVariable.copyFrom(v.dualVariable);
              minOuterDualVariableVertex = v;
            }
          }

          // Re-initialize minOuterOuterEdgeResistance.
          minOuterOuterEdgeResistance.copyFrom(this.aboveMaxEdgeWeight);
          minOuterOuterEdgeResistanceRootBlossom = undefined;
          for (const rb of this.rootBlossoms) {
            if (
              rb.label === Label.OUTER &&
              rb.minOuterEdgeResistance.lt(minOuterOuterEdgeResistance)
            ) {
              minOuterOuterEdgeResistance.copyFrom(rb.minOuterEdgeResistance);
              minOuterOuterEdgeResistanceRootBlossom = rb;
            }
          }

          // Re-initialize minInnerDualVariable.
          minInnerDualVariable.copyFrom(this.aboveMaxEdgeWeight);
          minInnerDualVariableBlossom = undefined;
          this.initializeMinInnerDualVariable(
            (blossom) => {
              minInnerDualVariableBlossom = blossom;
            },
            (value) => {
              minInnerDualVariable.copyFrom(value);
            },
          );

          // Continue the main loop.
          continue;
        } else {
          // DIFFERENT ROOTS → augment.
          augmentToSource(vertex0, vertex1);
          augmentToSource(vertex1, vertex0);
          return true;
        }
      }

      // -----------------------------------------------------------------------
      // CASE 4: FREE↔OUTER tight edge (minInnerOuterEdgeResistance == 0,
      //         but the vertex is FREE not ZERO)
      // -----------------------------------------------------------------------
      else if (minInnerOuterEdgeResistance.isZero()) {
        const freeVertex = minInnerOuterEdgeResistanceVertex;
        if (freeVertex === undefined) {
          return false;
        }

        const freeRb = freeVertex.rootBlossom!;
        // The free vertex becomes INNER.
        freeRb.label = Label.INNER;
        freeRb.labelingVertex = freeVertex.minOuterEdge;
        freeRb.labeledVertex = freeVertex;

        // The match of the base of freeRb becomes OUTER.
        const matchedRb = freeRb.baseVertexMatch!.rootBlossom!;
        matchedRb.label = Label.OUTER;

        // Update inner-outer edges for the newly OUTER blossom.
        this.updateInnerOuterEdges(matchedRb);

        // Initialize outer-outer edges for the newly OUTER blossom.
        this.initializeOuterOuterEdgesForBlossom(matchedRb);

        // Update minOuterDualVariable for vertices in new OUTER blossom.
        for (
          let v: Vertex | undefined = matchedRb.rootChild.vertexListHead;
          v;
          v = v.nextVertex
        ) {
          if (v.dualVariable.lt(minOuterDualVariable)) {
            minOuterDualVariable.copyFrom(v.dualVariable);
            minOuterDualVariableVertex = v;
          }
        }

        // Update minOuterOuterEdgeResistance.
        if (matchedRb.minOuterEdgeResistance.lt(minOuterOuterEdgeResistance)) {
          minOuterOuterEdgeResistance.copyFrom(
            matchedRb.minOuterEdgeResistance,
          );
          minOuterOuterEdgeResistanceRootBlossom = matchedRb;
        }

        // Update minInnerDualVariable for the newly INNER blossom.
        if (!freeRb.rootChild.isVertex) {
          const pb = freeRb.rootChild as ParentBlossom;
          if (pb.dualVariable.lt(minInnerDualVariable)) {
            minInnerDualVariable.copyFrom(pb.dualVariable);
            minInnerDualVariableBlossom = pb;
          }
        }

        // Continue main loop.
        continue;
      }

      // -----------------------------------------------------------------------
      // CASE 5: INNER blossom dual → 0 (dissolve)
      // -----------------------------------------------------------------------
      else if (minInnerDualVariable.isZero()) {
        const pb = minInnerDualVariableBlossom;
        if (pb === undefined) {
          return false;
        }

        const dissolvedRb = pb.rootBlossom!;

        // Hide the dissolved RootBlossom from rootBlossoms.
        const rbIndex = this.rootBlossoms.indexOf(dissolvedRb);
        if (rbIndex !== -1) this.rootBlossoms.splice(rbIndex, 1);

        // The root child of the dissolved blossom is pb.
        // In C++: rootVertex = dissolvedRb.baseVertex
        //         rootChild = getAncestorOfVertex(rootVertex, pb)
        const rootVertex = dissolvedRb.baseVertex;
        const rootChild: Blossom = getAncestorOfVertex(rootVertex, pb);

        // The connect child is the child of pb containing the labeled vertex.
        const connectChild: Blossom = getAncestorOfVertex(
          dissolvedRb.labeledVertex!,
          pb,
        );

        // Determine if the path from rootChild to connectChild goes forward
        // (i.e., via nextBlossom links). Walk forward from rootChild;
        // if we reach connectChild, connectForward=true; otherwise false.
        let connectForward: boolean;
        {
          let found = false;
          for (
            let current: Blossom | undefined = rootChild.nextBlossom;
            current !== rootChild && current !== undefined;
            current = current.nextBlossom
          ) {
            if (current === connectChild) {
              found = true;
              break;
            }
          }
          connectForward = rootChild === connectChild || found;
        }

        // Walk the circular child list, assigning labels.
        // C++ loop: iterate from rootChild going forward (nextBlossom),
        // wrapping around until we return to rootChild.
        let isFree = false;
        let linksToNext = false; // tracks edge direction alternation

        // Find the actual previous of rootChild by walking the cycle.
        let previousChild: Blossom;
        {
          let current: Blossom = rootChild;
          while (
            current.nextBlossom !== rootChild &&
            current.nextBlossom !== undefined
          ) {
            current = current.nextBlossom;
          }
          previousChild = current;
        }

        let currentChild: Blossom = rootChild;
        let nextChild: Blossom | undefined;
        const newRootBlossoms: RootBlossom[] = [];

        do {
          nextChild = currentChild.nextBlossom;

          // C++ logic for setting isFree: if we hit connectChild going
          // in the non-connectForward direction, isFree becomes false.
          if (currentChild === connectChild && !connectForward) {
            isFree = false;
          }

          // Determine label for this child.
          // The rootChild itself is always INNER (it's the base vertex side).
          // After that, labels alternate: for the path going toward connectChild,
          // we get INNER for even steps, OUTER for odd steps.
          // Children on the other side are FREE.
          const label: Label = isFree
            ? Label.FREE
            : linksToNext !== connectForward || currentChild === rootChild
              ? Label.INNER
              : Label.OUTER;

          // Determine baseVertex and baseVertexMatch for the new RootBlossom.
          let newBaseVertex: Vertex;
          let newBaseVertexMatch: Vertex | undefined;
          let newLabelingVertex: Vertex | undefined;
          let newLabeledVertex: Vertex | undefined;

          if (currentChild === rootChild) {
            newBaseVertex = rootVertex;
            newBaseVertexMatch = dissolvedRb.baseVertexMatch;
          } else if (linksToNext) {
            newBaseVertex = currentChild.vertexToNextSiblingBlossom!;
            newBaseVertexMatch = nextChild?.vertexToPreviousSiblingBlossom;
          } else {
            newBaseVertex = currentChild.vertexToPreviousSiblingBlossom!;
            newBaseVertexMatch = previousChild?.vertexToNextSiblingBlossom;
          }

          if (currentChild === connectChild) {
            newLabelingVertex = dissolvedRb.labelingVertex;
            newLabeledVertex = dissolvedRb.labeledVertex;
          } else if (label === Label.INNER) {
            if (connectForward) {
              newLabelingVertex = nextChild?.vertexToPreviousSiblingBlossom;
              newLabeledVertex = currentChild.vertexToNextSiblingBlossom;
            } else {
              newLabelingVertex = previousChild?.vertexToNextSiblingBlossom;
              newLabeledVertex = currentChild.vertexToPreviousSiblingBlossom;
            }
          }

          // Create new RootBlossom for this child.
          const newRb = new RootBlossom(
            currentChild,
            newBaseVertex,
            newBaseVertexMatch,
            this,
          );
          newRb.label = label;
          newRb.labelingVertex = newLabelingVertex;
          newRb.labeledVertex = newLabeledVertex;

          // Disconnect child from the old ParentBlossom.
          currentChild.parentBlossom = undefined;

          // Update rootBlossom pointer for all vertices and nested ParentBlossoms.
          newRb.updateRootBlossomInDescendants();

          // Set up minOuterEdges array (size = number of vertices).
          while (newRb.minOuterEdges.length < this.vertices.length) {
            newRb.minOuterEdges.push(undefined);
          }

          this.rootBlossoms.push(newRb);
          this.rootBlossomMinOuterEdgeResistances.push(
            this.aboveMaxEdgeWeight.clone(),
          );
          newRootBlossoms.push(newRb);

          // For OUTER children: update inner-outer and outer-outer edges,
          // and update minOuterDualVariable.
          if (label === Label.OUTER) {
            this.updateInnerOuterEdges(newRb);
            this.initializeOuterOuterEdgesForBlossom(newRb);
            for (
              let v: Vertex | undefined = currentChild.vertexListHead;
              v;
              v = v.nextVertex
            ) {
              if (v.dualVariable.lt(minOuterDualVariable)) {
                minOuterDualVariable.copyFrom(v.dualVariable);
                minOuterDualVariableVertex = v;
              }
            }
            if (newRb.minOuterEdgeResistance.lt(minOuterOuterEdgeResistance)) {
              minOuterOuterEdgeResistance.copyFrom(
                newRb.minOuterEdgeResistance,
              );
              minOuterOuterEdgeResistanceRootBlossom = newRb;
            }
          }

          // Update isFree state after processing this child.
          if (currentChild === (connectForward ? connectChild : rootChild)) {
            isFree = true;
          }

          linksToNext = !linksToNext;
          previousChild = currentChild;
          currentChild = nextChild!;
        } while (currentChild !== rootChild);

        // Destroy the old ParentBlossom and RootBlossom.
        const pbIndex = this.parentBlossoms.indexOf(pb);
        if (pbIndex !== -1) this.parentBlossoms.splice(pbIndex, 1);

        // Re-initialize minInnerDualVariable after dissolution.
        minInnerDualVariable.copyFrom(this.aboveMaxEdgeWeight);
        minInnerDualVariableBlossom = undefined;
        this.initializeMinInnerDualVariable(
          (blossom) => {
            minInnerDualVariableBlossom = blossom;
          },
          (value) => {
            minInnerDualVariable.copyFrom(value);
          },
        );

        // Continue main loop.
        continue;
      } else {
        // No more progress possible.
        return false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Initialization helpers
  // ---------------------------------------------------------------------------

  /**
   * For each non-OUTER blossom vertex, find cheapest edge to any OUTER vertex.
   */
  private initializeInnerOuterEdges(): void {
    const rs = this.resistanceStorage;
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
            resistanceInto(rs, v, outerV);
            if (
              v.minOuterEdge === undefined ||
              rs.lt(v.minOuterEdgeResistance)
            ) {
              v.minOuterEdge = outerV;
              v.minOuterEdgeResistance.copyFrom(rs);
            }
          }
        }
      }
    }
  }

  /**
   * For each pair of OUTER blossoms, find cheapest edge between them.
   * Updates minOuterEdges and minOuterEdgeResistance for each OUTER blossom.
   */
  private initializeOuterOuterEdges(): void {
    for (const rb of this.rootBlossoms) {
      if (rb.label !== Label.OUTER) continue;
      for (const otherRb of this.rootBlossoms) {
        if (otherRb === rb) continue;
        if (otherRb.label !== Label.OUTER) continue;
        this.updateOuterOuterEdgePair(rb, otherRb);
      }
    }
  }

  /**
   * For a newly OUTER blossom, initialize its outer-outer edges against all
   * other OUTER blossoms (single-blossom variant, C++ initializeOuterOuterEdges(blossom)).
   */
  private initializeOuterOuterEdgesForBlossom(newOuterRb: RootBlossom): void {
    for (const rb of this.rootBlossoms) {
      if (rb === newOuterRb || rb.label !== Label.OUTER) continue;
      this.updateOuterOuterEdgePair(newOuterRb, rb);
      this.updateOuterOuterEdgePair(rb, newOuterRb);
    }
  }

  /**
   * For a newly OUTER blossom, update inner-outer edges for all non-OUTER
   * blossoms: vertices in those blossoms may now have cheaper edges to this
   * new OUTER blossom.
   * (C++ updateInnerOuterEdges(rootBlossom))
   */
  private updateInnerOuterEdges(newOuterRb: RootBlossom): void {
    const rs = this.resistanceStorage;
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
          resistanceInto(rs, v, outerV);
          if (v.minOuterEdge === undefined || rs.lt(v.minOuterEdgeResistance)) {
            v.minOuterEdge = outerV;
            v.minOuterEdgeResistance.copyFrom(rs);
          }
        }
      }
    }
  }

  /**
   * Update rb1's minOuterEdges tracking with edges to rb2.
   * For each vertex pair (v1 in rb1, v2 in rb2), if the edge is tighter than
   * the current best for rb1, update rb1.minOuterEdges[v2.vertexIndex] and
   * rb1.minOuterEdgeResistance.
   */
  private updateOuterOuterEdgePair(rb1: RootBlossom, rb2: RootBlossom): void {
    const rs = this.resistanceStorage;
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
        resistanceInto(rs, v1, v2);
        if (
          rb1.minOuterEdgeResistance.lt(this.aboveMaxEdgeWeight)
            ? rs.lt(rb1.minOuterEdgeResistance)
            : true
        ) {
          rb1.minOuterEdgeResistance.copyFrom(rs);
          rb1.minOuterEdges[v2.vertexIndex] = v1;
        }
      }
    }
  }

  /**
   * Scan all INNER root blossoms with compound children (ParentBlossom) and
   * call the two callbacks when a new minimum is found.
   */
  private initializeMinInnerDualVariable(
    setBlossom: (pb: ParentBlossom) => void,
    setValue: (v: DynamicUint) => void,
  ): void {
    const minValue = this.aboveMaxEdgeWeight.clone();
    for (const rb of this.rootBlossoms) {
      if (rb.label === Label.INNER && !rb.rootChild.isVertex) {
        const pb = rb.rootChild as ParentBlossom;
        if (pb.dualVariable.lt(minValue)) {
          minValue.copyFrom(pb.dualVariable);
          setBlossom(pb);
          setValue(pb.dualVariable);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Blossom formation from path (Case 3, same root)
  // ---------------------------------------------------------------------------

  /**
   * Form a new blossom from the given path of vertices.
   * The path describes an odd cycle in the alternating tree.
   * Creates a ParentBlossom that wraps all the existing child blossoms,
   * and a RootBlossom pointing to it.
   *
   * Ported from bbpPairings `rootblossom.cpp` path-iterator constructor.
   */
  private formBlossomFromPath(path: Vertex[]): void {
    if (path.length < 2) return;

    // Collect ALL unique RootBlossoms referenced by path vertices.
    // The C++ initializeFromChildren destroys all of them.
    const oldRbs: RootBlossom[] = [];
    const seenRbs = new Set<RootBlossom>();
    for (const v of path) {
      const rb = v.rootBlossom!;
      if (!seenRbs.has(rb)) {
        seenRbs.add(rb);
        oldRbs.push(rb);
      }
    }
    // The base rootBlossom (carries label, base vertex, match info).
    const oldRb = path[0]!.rootBlossom!;

    // The path alternates between child-blossom boundary vertices.
    // path[0], path[1] = first pair: path[0] is inside child A (exit vertex),
    //                                path[1] is inside child B (entry vertex).
    // path[2], path[3] = next pair, etc.
    //
    // The first child (ancestor of path[0] under undefined) becomes previousChild.
    // The last child is the ancestor of path[path.length-1] under undefined.
    // vertex list: head from last child's head, tail from first child's tail
    // (C++ parentblossomimpl.h:28-31).

    const firstChild: Blossom = getAncestorOfVertex(path[0]!);
    const lastChild: Blossom = getAncestorOfVertex(path.at(-1)!);

    // Create the new zero dual variable.
    const newDual = this.aboveMaxEdgeWeight.clone().and(0);

    // Create the ParentBlossom.
    // vertexListHead = last child's vertexListHead (C++ prepends in reverse)
    // vertexListTail = first child's vertexListTail
    const newParent = new ParentBlossom(
      newDual,
      oldRb,
      firstChild,
      lastChild.vertexListHead,
      firstChild.vertexListTail,
    );

    // connectChildren sets up the sibling linked list starting from firstChild.
    // After this call, newParent.subblossom points to the last child.
    // All children except the first get parentBlossom = newParent.
    newParent.connectChildren(path);

    // The first child also needs parentBlossom = newParent.
    firstChild.parentBlossom = newParent;

    // Close the circular linked list: lastChild.nextBlossom → firstChild.
    // freeAncestorOfBase iterates the circular list and relies on this.
    const lastChild2 = newParent.subblossom; // subblossom = last child after connectChildren
    lastChild2.nextBlossom = firstChild;
    firstChild.previousBlossom = lastChild2;

    // Link vertex lists of children together in reverse path order.
    // C++ rootblossom.cpp:166-174 links them so the final list is:
    //   lastChild → ... → firstChild
    // matching parentblossomimpl.h:28-31 which sets:
    //   vertexListHead = lastChild.vertexListHead
    //   vertexListTail = firstChild.vertexListTail
    //
    // Collect children in forward order (firstChild → ... → lastChild),
    // counting exactly childCount = path.length/2 + 1 children.
    {
      const childCount = Math.floor(path.length / 2) + 1;
      const children: Blossom[] = [];
      let current: Blossom = firstChild;
      for (let index = 0; index < childCount; index++) {
        children.push(current);
        current = current.nextBlossom!; // safe: cycle is closed
      }

      // Link in reverse: lastChild.tail → secondToLast.head → ... → firstChild.head.
      for (let index = children.length - 1; index > 0; index--) {
        children[index]!.vertexListTail.nextVertex =
          children[index - 1]!.vertexListHead;
      }
      // Terminate the list at firstChild's tail.
      firstChild.vertexListTail.nextVertex = undefined;
    }

    this.parentBlossoms.push(newParent);

    // Create the new RootBlossom wrapping newParent.
    const newRb = new RootBlossom(
      newParent,
      oldRb.baseVertex,
      oldRb.baseVertexMatch,
      this,
    );
    newRb.label = Label.OUTER;
    newRb.labeledVertex = undefined;
    newRb.labelingVertex = undefined;

    // Set up minOuterEdges array.
    while (newRb.minOuterEdges.length < this.vertices.length) {
      newRb.minOuterEdges.push(undefined);
    }

    // Set newParent's parentBlossom to undefined (directly under RootBlossom).
    newParent.parentBlossom = undefined;

    // Update rootBlossom pointers for all descendants.
    newRb.updateRootBlossomInDescendants();

    // Remove ALL old RootBlossoms from the list.
    for (const rb of oldRbs) {
      const index = this.rootBlossoms.indexOf(rb);
      if (index !== -1) this.rootBlossoms.splice(index, 1);
    }

    // Add new RootBlossom.
    this.rootBlossoms.push(newRb);
    this.rootBlossomMinOuterEdgeResistances.push(
      this.aboveMaxEdgeWeight.clone(),
    );

    // Initialize outer-outer edges for the new blossom.
    this.initializeOuterOuterEdgesForBlossom(newRb);
    this.updateInnerOuterEdges(newRb);
  }
}

export { Graph };
