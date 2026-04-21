/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { DynamicUint } from '../dynamic-uint.js';
import type { Label } from './types.js';
import type { Vertex } from './vertex.js';

/**
 * Minimal graph interface required by RootBlossom methods.
 * The full Graph class is implemented in Task 3.
 *
 * @internal
 */
interface GraphLike {
  readonly aboveMaxEdgeWeight: DynamicUint;
  parentBlossoms: ParentBlossom[];
  readonly vertexDualVariables: DynamicUint[];
  rootBlossoms: RootBlossom[];
}

// ---------------------------------------------------------------------------
// ParentBlossom
// ---------------------------------------------------------------------------

/**
 * A compound blossom — an odd cycle contracted into a pseudo-vertex.
 *
 * Ported from bbpPairings `parentblossomsig.h` + `parentblossomimpl.h`.
 *
 * @internal Not part of the public API.
 */
class ParentBlossom {
  /** Discriminator — always `false` for ParentBlossom. */
  readonly isVertex = false as const;

  /** Dual variable of this compound blossom. */
  dualVariable: DynamicUint;

  /** Whether iteration (for putVerticesInMatchingOrder) starts with subblossom. */
  iterationStartsWithSubblossom: boolean;

  /** Next blossom child link within the parent blossom's cycle. */
  nextBlossom: Blossom | undefined;

  /** The immediate parent compound blossom, or `undefined` if directly under a RootBlossom. */
  parentBlossom: ParentBlossom | undefined;

  /** Previous blossom child link within the parent blossom's cycle. */
  previousBlossom: Blossom | undefined;

  /**
   * The RootBlossom at the top of the blossom tree containing this blossom.
   * Set when the blossom is placed under a RootBlossom.
   */
  rootBlossom: RootBlossom;

  /**
   * One child blossom — used as the iteration start by putVerticesInMatchingOrder.
   * Points to the child blossom through which the base vertex path enters.
   */
  subblossom: Blossom;

  /** Head of the vertex linked list for all vertices in this blossom. */
  vertexListHead: Vertex;

  /** Tail of the vertex linked list for all vertices in this blossom. */
  vertexListTail: Vertex;

  /** Link to the vertex that connects to the next sibling blossom in parent. */
  vertexToNextSiblingBlossom: Vertex | undefined;

  /** Link to the vertex that connects to the previous sibling blossom in parent. */
  vertexToPreviousSiblingBlossom: Vertex | undefined;

  constructor(
    dualVariable: DynamicUint,
    rootBlossom: RootBlossom,
    subblossom: Blossom,
    vertexListHead: Vertex,
    vertexListTail: Vertex,
  ) {
    this.dualVariable = dualVariable;
    this.iterationStartsWithSubblossom = false;
    this.nextBlossom = undefined;
    this.parentBlossom = undefined;
    this.previousBlossom = undefined;
    this.rootBlossom = rootBlossom;
    this.subblossom = subblossom;
    this.vertexListHead = vertexListHead;
    this.vertexListTail = vertexListTail;
    this.vertexToNextSiblingBlossom = undefined;
    this.vertexToPreviousSiblingBlossom = undefined;
  }
}

// ---------------------------------------------------------------------------
// Blossom union type
// ---------------------------------------------------------------------------

/**
 * Discriminated union of the two blossom node types.
 *
 * - `Vertex` (`isVertex === true`): a leaf node in the blossom tree.
 * - `ParentBlossom` (`isVertex === false`): an odd cycle contracted into a
 *   pseudo-vertex.
 *
 * @internal Not part of the public API.
 */
type Blossom = ParentBlossom | Vertex;

// ---------------------------------------------------------------------------
// Helper functions (blossomimpl.h)
// ---------------------------------------------------------------------------

/**
 * Walk upward from `vertex` until the parent of the current blossom equals
 * `ancestor`, returning that child-of-`ancestor` blossom.
 */
function getAncestorOfVertex(
  vertex: Vertex,
  ancestor?: ParentBlossom,
): Blossom {
  let blossom: Blossom = vertex;
  while (blossom.parentBlossom !== ancestor) {
    blossom = blossom.parentBlossom!;
  }
  return blossom;
}

/**
 * Walk upward from `vertex` to `ancestor`, setting `subblossom` and
 * `iterationStartsWithSubblossom` on each intermediate ParentBlossom.
 */
function setPointersFromAncestor(
  vertex: Vertex,
  ancestor: Blossom,
  startWithSubblossom: boolean,
): void {
  let blossom: Blossom = vertex;
  while (blossom !== ancestor) {
    blossom.parentBlossom!.subblossom = blossom;
    blossom.parentBlossom!.iterationStartsWithSubblossom = startWithSubblossom;
    blossom = blossom.parentBlossom!;
  }
}

// ---------------------------------------------------------------------------
// RootBlossom
// ---------------------------------------------------------------------------

/**
 * Top-level wrapper for a blossom tree.
 *
 * One RootBlossom exists per connected component of the matching. It is NOT
 * in the Blossom hierarchy (not a Vertex or ParentBlossom) — it wraps the
 * root child blossom and carries augmentation metadata.
 *
 * Ported from bbpPairings `rootblossomsig.h` + `rootblossom.cpp`.
 *
 * @internal Not part of the public API.
 */
class RootBlossom {
  /** Representative vertex for this blossom (the "base"). */
  baseVertex: Vertex;

  /** The matched partner's base vertex. `undefined` = exposed (unmatched). */
  baseVertexMatch: Vertex | undefined;

  /** Label assigned during augmentation. */
  label: Label;

  /** Vertex that received a label during augmentation. */
  labeledVertex: Vertex | undefined;

  /** Vertex that carried the label to `labeledVertex` during augmentation. */
  labelingVertex: Vertex | undefined;

  /**
   * Minimum resistance outer edge indexed by the other RootBlossom's base
   * vertex index.
   */
  minOuterEdgeResistance: DynamicUint;

  /**
   * Minimum resistance outer edge per other RootBlossom's base vertex index.
   */
  minOuterEdges: (Vertex | undefined)[];

  /** The direct child of this RootBlossom in the blossom tree. */
  rootChild: Blossom;

  constructor(
    rootChild: Blossom,
    baseVertex: Vertex,
    baseVertexMatch: Vertex | undefined,
    graph: GraphLike,
  ) {
    this.baseVertex = baseVertex;
    this.baseVertexMatch = baseVertexMatch;
    this.label = 3 as Label; // Label.FREE
    this.labeledVertex = undefined;
    this.labelingVertex = undefined;
    this.minOuterEdgeResistance = graph.aboveMaxEdgeWeight.clone();
    this.minOuterEdges = [];
    this.rootChild = rootChild;
  }

  // ---------------------------------------------------------------------------
  // prepareVertexForWeightAdjustments (rootblossomimpl.h:137-153)
  // ---------------------------------------------------------------------------

  /**
   * Prepares `vertex` for weight adjustments by:
   * 1. Disconnecting the current match.
   * 2. Setting `baseVertex` to `vertex`.
   * 3. Dissolving all enclosing ParentBlossoms above `vertex` into independent
   *    RootBlossoms (freeAncestorOfBase).
   * 4. Resetting `vertex.dualVariable` to `aboveMaxEdgeWeight >> 1`.
   *
   * Ported from bbpPairings `rootblossomimpl.h:137-153`.
   */
  prepareVertexForWeightAdjustments(vertex: Vertex, graph: GraphLike): void {
    if (this.baseVertexMatch) {
      this.baseVertexMatch.rootBlossom!.baseVertexMatch = undefined;
      this.baseVertexMatch = undefined;
    }
    this.baseVertex = vertex;

    this.freeAncestorOfBase(vertex, graph);

    vertex.dualVariable = graph.aboveMaxEdgeWeight.clone();
    vertex.dualVariable.shiftRight(1);
  }

  // ---------------------------------------------------------------------------
  // putVerticesInMatchingOrder (rootblossom.cpp:22-80)
  // ---------------------------------------------------------------------------

  /**
   * Reorders the vertex linked list within this RootBlossom so that
   * `getMatching` can read matched pairs consecutively.
   *
   * Ported from bbpPairings `rootblossom.cpp:22-80`.
   */
  putVerticesInMatchingOrder(): void {
    let currentBlossom: Blossom = this.rootChild;
    let currentVertex: Vertex = this.baseVertex;
    let startsWithBase = true;

    do {
      setPointersFromAncestor(currentVertex, currentBlossom, startsWithBase);
      currentBlossom = currentVertex;

      while (currentBlossom !== this.rootChild) {
        const nextBlossom: Blossom = currentBlossom.nextBlossom!;
        startsWithBase =
          !startsWithBase &&
          currentBlossom.parentBlossom!.subblossom !== currentBlossom;

        currentBlossom.previousBlossom!.vertexListTail.nextVertex =
          currentBlossom.vertexListHead;

        currentBlossom = nextBlossom;

        if (currentBlossom === currentBlossom.parentBlossom!.subblossom) {
          const parentBlossom: ParentBlossom = currentBlossom.parentBlossom!;
          startsWithBase = parentBlossom.iterationStartsWithSubblossom;

          currentBlossom.previousBlossom!.vertexListTail.nextVertex =
            currentBlossom.vertexListHead;

          parentBlossom.vertexListHead = (
            startsWithBase ? currentBlossom : currentBlossom.nextBlossom!
          ).vertexListHead;

          parentBlossom.vertexListTail = (
            startsWithBase ? currentBlossom.previousBlossom! : currentBlossom
          ).vertexListTail;

          currentBlossom = parentBlossom;
          // Repeat inner loop, iterating up to the parent blossom.
        } else {
          currentVertex = startsWithBase
            ? currentBlossom.vertexToPreviousSiblingBlossom!
            : currentBlossom.vertexToNextSiblingBlossom!;
          break;
          // Repeat outer loop with a new Vertex.
        }
      }
    } while (currentBlossom !== this.rootChild);

    this.rootChild.vertexListTail.nextVertex = undefined;
  }

  // ---------------------------------------------------------------------------
  // freeAncestorOfBase (rootblossom.cpp:184-274)
  // ---------------------------------------------------------------------------

  /**
   * Dissolves all compound blossoms enclosing `ancestor` up to the root,
   * creating independent RootBlossoms for each sibling and propagating dual
   * variables down.
   *
   * Ported from bbpPairings `rootblossom.cpp:184-274`.
   */
  private freeAncestorOfBase(ancestor: Blossom, graph: GraphLike): void {
    if (ancestor === this.rootChild) {
      return;
    }

    // Calculate the total dualVariable adjustment from all enclosing blossoms.
    const dualVariableAdjustment = graph.aboveMaxEdgeWeight.clone().and(0);
    let blossom: ParentBlossom | undefined = ancestor.parentBlossom;
    while (blossom) {
      dualVariableAdjustment.add(blossom.dualVariable.clone().shiftRight(1));
      blossom = blossom.parentBlossom;
    }

    blossom = ancestor.parentBlossom;
    let nextBlossom: Blossom | undefined = ancestor.nextBlossom;

    // Create a RootBlossom for ancestor.
    const ancestorRoot = new RootBlossom(
      ancestor,
      this.baseVertex,
      this.baseVertexMatch,
      graph,
    );
    graph.rootBlossoms.push(ancestorRoot);

    for (
      let iterator: Vertex | undefined = ancestor.vertexListHead;
      iterator;
      iterator = iterator.nextVertex
    ) {
      iterator.dualVariable.add(dualVariableAdjustment);
    }

    // Create all the other RootBlossoms for siblings of ancestor.
    let childToFree: Blossom = ancestor;
    while (blossom) {
      let linksForward = true;
      let previousBlossom: Blossom | undefined;

      for (
        let currentBlossom: Blossom | undefined = nextBlossom;
        currentBlossom !== childToFree;
        currentBlossom = nextBlossom
      ) {
        nextBlossom = currentBlossom!.nextBlossom;

        const siblingBaseVertex = linksForward
          ? currentBlossom!.vertexToNextSiblingBlossom!
          : currentBlossom!.vertexToPreviousSiblingBlossom!;

        const siblingBaseVertexMatch = linksForward
          ? nextBlossom?.vertexToPreviousSiblingBlossom
          : previousBlossom?.vertexToNextSiblingBlossom;

        const siblingRoot = new RootBlossom(
          currentBlossom!,
          siblingBaseVertex,
          siblingBaseVertexMatch,
          graph,
        );
        graph.rootBlossoms.push(siblingRoot);

        for (
          let iterator: Vertex | undefined = currentBlossom!.vertexListHead;
          iterator;
          iterator = iterator.nextVertex
        ) {
          iterator.dualVariable.add(dualVariableAdjustment);
        }

        linksForward = !linksForward;
        previousBlossom = currentBlossom;
      }

      dualVariableAdjustment.subtract(
        blossom.dualVariable.clone().shiftRight(1),
      );

      if (childToFree !== ancestor) {
        // Destroy unused ParentBlossom.
        const index = graph.parentBlossoms.indexOf(
          childToFree as ParentBlossom,
        );
        if (index !== -1) graph.parentBlossoms.splice(index, 1);
      }

      childToFree = blossom;
      nextBlossom = blossom.nextBlossom;
      blossom = blossom.parentBlossom;
    }

    // Destroy the old RootBlossom's rootChild (the outermost ParentBlossom).
    const rootChildIndex = graph.parentBlossoms.indexOf(
      this.rootChild as ParentBlossom,
    );
    if (rootChildIndex !== -1) graph.parentBlossoms.splice(rootChildIndex, 1);

    // Destroy this RootBlossom.
    const selfIndex = graph.rootBlossoms.indexOf(this);
    if (selfIndex !== -1) graph.rootBlossoms.splice(selfIndex, 1);
  }
}

export type { Blossom, GraphLike };
export {
  getAncestorOfVertex,
  ParentBlossom,
  RootBlossom,
  setPointersFromAncestor,
};
