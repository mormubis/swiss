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
    const vertex = new Vertex(index, zero, this.aboveMaxEdgeWeight);
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
      // Reset labeling state (C++ graph.cpp:188-203).
      // Do NOT reset minOuterEdgeResistance or minOuterEdges[] here — the C++
      // preserves these across augmentation calls. They are recomputed per
      // OUTER blossom in initializeOuterOuterEdges().
      // Per-vertex minOuterEdge is reset in initializeInnerOuterEdges().
      rb.labeledVertex = undefined;
      rb.labelingVertex = undefined;

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
            const v0: Vertex | undefined =
              rb0.minOuterEdges[rb1.baseVertex.vertexIndex];
            const v1: Vertex | undefined =
              rb1.minOuterEdges[rb0.baseVertex.vertexIndex];
            if (
              v0 !== undefined &&
              v1 !== undefined &&
              v0.rootBlossom === rb0 &&
              v1.rootBlossom === rb1
            ) {
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
        // (i.e., via nextBlossom links). C++ parity-flip pattern: count
        // steps from rootChild to connectChild; even distance = forward.
        let connectForward = true;
        for (
          let current: Blossom | undefined = rootChild;
          current !== connectChild;
          current = current!.nextBlossom
        ) {
          connectForward = !connectForward;
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
    // Pre-collect outer vertices into flat array (C++ graph.cpp:240-248).
    // Avoids re-scanning rootBlossoms × vertex lists for every inner vertex.
    const outerVertices: Vertex[] = [];
    for (const v of this.vertices) {
      if (v.rootBlossom!.label === Label.OUTER) {
        outerVertices.push(v);
      }
    }

    const rs = this.resistanceStorage;
    for (const v of this.vertices) {
      if (v.rootBlossom!.label === Label.OUTER) continue;
      v.minOuterEdgeResistance.copyFrom(this.aboveMaxEdgeWeight);
      v.minOuterEdge = undefined;
      for (const outerV of outerVertices) {
        if (v.vertexIndex === outerV.vertexIndex) continue;
        resistanceInto(rs, v, outerV);
        if (rs.lt(v.minOuterEdgeResistance)) {
          v.minOuterEdge = outerV;
          v.minOuterEdgeResistance.copyFrom(rs);
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
      // Reset per-blossom outer-outer tracking (C++ graph.cpp:275).
      rb.minOuterEdgeResistance.copyFrom(this.aboveMaxEdgeWeight);
      for (let index = 0; index < rb.minOuterEdges.length; index++) {
        rb.minOuterEdges[index] = undefined;
      }
      for (const otherRb of this.rootBlossoms) {
        if (otherRb === rb) continue;
        if (otherRb.label !== Label.OUTER) continue;
        const pairMin = this.aboveMaxEdgeWeight.clone();
        rb.minOuterEdges[otherRb.baseVertex.vertexIndex] = undefined;
        this.updateOuterOuterEdges(rb, otherRb, pairMin);
      }
    }
  }

  private initializeOuterOuterEdgesForBlossom(newOuterRb: RootBlossom): void {
    newOuterRb.minOuterEdgeResistance.copyFrom(this.aboveMaxEdgeWeight);
    const pairMin = this.aboveMaxEdgeWeight.clone();
    for (const rb of this.rootBlossoms) {
      if (rb === newOuterRb || rb.label !== Label.OUTER) continue;
      pairMin.copyFrom(this.aboveMaxEdgeWeight);
      newOuterRb.minOuterEdges[rb.baseVertex.vertexIndex] = undefined;
      this.updateOuterOuterEdges(newOuterRb, rb, pairMin);
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
    for (const innerVertex of this.vertices) {
      if (innerVertex.rootBlossom!.label === Label.OUTER) continue;
      for (
        let outerV: Vertex | undefined = newOuterRb.rootChild.vertexListHead;
        outerV;
        outerV = outerV.nextVertex
      ) {
        if (innerVertex.vertexIndex === outerV.vertexIndex) continue;
        resistanceInto(rs, innerVertex, outerV);
        if (
          innerVertex.minOuterEdge === undefined ||
          rs.lt(innerVertex.minOuterEdgeResistance)
        ) {
          innerVertex.minOuterEdge = outerV;
          innerVertex.minOuterEdgeResistance.copyFrom(rs);
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
  private updateOuterOuterEdges(
    rb0: RootBlossom,
    rb1: RootBlossom,
    pairMinResistance: DynamicUint,
  ): void {
    const actualRb0 = rb0.rootChild.rootBlossom!;
    const actualRb1 = rb1.rootChild.rootBlossom!;
    const rs = this.resistanceStorage;
    for (
      let v0: Vertex | undefined = rb0.rootChild.vertexListHead;
      v0;
      v0 = v0.nextVertex
    ) {
      for (
        let v1: Vertex | undefined = rb1.rootChild.vertexListHead;
        v1;
        v1 = v1.nextVertex
      ) {
        resistanceInto(rs, v0, v1);
        if (rs.lt(pairMinResistance)) {
          pairMinResistance.copyFrom(rs);
          actualRb0.minOuterEdges[actualRb1.baseVertex.vertexIndex] = v0;
          actualRb1.minOuterEdges[actualRb0.baseVertex.vertexIndex] = v1;
          if (rs.lt(actualRb0.minOuterEdgeResistance)) {
            actualRb0.minOuterEdgeResistance.copyFrom(rs);
          }
          if (rs.lt(actualRb1.minOuterEdgeResistance)) {
            actualRb1.minOuterEdgeResistance.copyFrom(rs);
          }
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

    const originalBlossoms: RootBlossom[] = [];
    for (let index = 0; index < path.length; index += 2) {
      originalBlossoms.push(path[index]!.rootBlossom!);
    }
    const baseRoot = path[0]!.rootBlossom!;

    const firstChild: Blossom = getAncestorOfVertex(path[0]!);
    const headChild: Blossom = getAncestorOfVertex(path.at(-2)!);

    const newDual = this.aboveMaxEdgeWeight.clone().and(0);
    const newParent = new ParentBlossom(
      newDual,
      baseRoot,
      firstChild,
      headChild.vertexListHead,
      firstChild.vertexListTail,
    );

    newParent.connectChildren(path);
    firstChild.parentBlossom = newParent;

    const lastChild = newParent.subblossom;
    if (lastChild !== firstChild) {
      lastChild.nextBlossom = firstChild;
      firstChild.previousBlossom = lastChild;
    }

    this.parentBlossoms.push(newParent);

    const newRb = new RootBlossom(
      newParent,
      baseRoot.baseVertex,
      baseRoot.baseVertexMatch,
      this,
    );
    newRb.label = baseRoot.label;
    newRb.labelingVertex = baseRoot.labelingVertex;
    newRb.labeledVertex = baseRoot.labeledVertex;

    while (newRb.minOuterEdges.length < this.vertices.length) {
      newRb.minOuterEdges.push(undefined);
    }
    for (let index = 0; index < baseRoot.minOuterEdges.length; index++) {
      newRb.minOuterEdges[index] = baseRoot.minOuterEdges[index];
    }

    newRb.minOuterEdgeResistance.copyFrom(this.aboveMaxEdgeWeight);

    // Link vertex lists (C++ forward order).
    let previousHead: Vertex | undefined;
    for (const rb of originalBlossoms) {
      if (rb.label !== Label.OUTER) {
        this.updateInnerOuterEdges(rb);
      }
      rb.rootChild.vertexListTail.nextVertex = previousHead;
      previousHead = rb.rootChild.vertexListHead;
    }
    if (previousHead) {
      newParent.vertexListHead = previousHead;
    }

    newRb.updateRootBlossomInDescendants();

    for (const rb of originalBlossoms) {
      const index = this.rootBlossoms.indexOf(rb);
      if (index !== -1) this.rootBlossoms.splice(index, 1);
    }

    this.rootBlossoms.push(newRb);
    this.rootBlossomMinOuterEdgeResistances.push(
      this.aboveMaxEdgeWeight.clone(),
    );

    this.initializeOuterOuterEdgesForBlossom(newRb);
    this.updateInnerOuterEdges(newRb);
  }
}

export { Graph };
