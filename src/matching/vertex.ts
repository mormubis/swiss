import type { DynamicUint } from '../dynamic-uint.js';

/**
 * Per-vertex state for the persistent matching computer.
 *
 * Ported from bbpPairings `vertexsig.h` + `verteximpl.h`.
 *
 * Dual variable is NOT stored here — it lives in
 * `graph.vertexDualVariables[vertex.vertexIndex]`.
 *
 * Edge weights are stored doubled internally to keep all values integral
 * when divided for dual-variable arithmetic.
 *
 * @internal Not part of the public API.
 */
class Vertex {
  /** Discriminator — always `true` for Vertex, used to distinguish from Blossom in the union type. */
  readonly isVertex = true as const;

  /** Immutable index identifying this vertex within the graph. */
  readonly vertexIndex: number;

  /** Edge weights indexed by the other vertex's index (stored doubled). */
  edgeWeights: DynamicUint[];

  // ---------------------------------------------------------------------------
  // Augmentation bookkeeping
  // ---------------------------------------------------------------------------

  /**
   * The other endpoint of the minimum-resistance outer edge.
   * `undefined` when no such edge has been recorded.
   */
  minOuterEdge: Vertex | undefined;

  /**
   * Minimum resistance among outgoing outer edges from this vertex.
   * Initialised to a zero-valued DynamicUint of appropriate word size.
   */
  minOuterEdgeResistance: DynamicUint;

  // ---------------------------------------------------------------------------
  // Blossom child links
  // ---------------------------------------------------------------------------

  /** Next blossom child link. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nextBlossom: any;

  /** Next vertex in the linked list of vertices belonging to the same RootBlossom. */
  nextVertex: Vertex | undefined;

  // ---------------------------------------------------------------------------
  // Blossom tree membership
  // ---------------------------------------------------------------------------

  /**
   * The immediate parent blossom of this vertex within the blossom tree.
   * Permissive type — tightened in Task 2 when Blossom classes are introduced.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parentBlossom: any;

  /** Previous blossom child link. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousBlossom: any;

  /**
   * The RootBlossom at the top of the blossom tree containing this vertex.
   * Permissive type — tightened in Task 2 when Blossom classes are introduced.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rootBlossom: any;

  // ---------------------------------------------------------------------------
  // Vertex linked list through enclosing RootBlossom
  // ---------------------------------------------------------------------------

  /** Head of the vertex list for the RootBlossom rooted at this vertex (points to self when singleton). */
  vertexListHead: Vertex;

  /** Tail of the vertex list for the RootBlossom rooted at this vertex (points to self when singleton). */
  vertexListTail: Vertex;

  // ---------------------------------------------------------------------------
  // Sibling links within parent blossom
  // ---------------------------------------------------------------------------

  /** Link to the next sibling blossom within the parent blossom. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vertexToNextSiblingBlossom: any;

  /** Link to the previous sibling blossom within the parent blossom. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vertexToPreviousSiblingBlossom: any;

  constructor(index: number, zero: DynamicUint) {
    this.vertexIndex = index;
    this.edgeWeights = [];
    this.minOuterEdge = undefined;
    this.minOuterEdgeResistance = zero.clone();
    this.nextBlossom = undefined;
    this.nextVertex = undefined;
    this.parentBlossom = undefined;
    this.previousBlossom = undefined;
    this.rootBlossom = undefined;
    this.vertexListHead = this;
    this.vertexListTail = this;
    this.vertexToNextSiblingBlossom = undefined;
    this.vertexToPreviousSiblingBlossom = undefined;
  }
}

export { Vertex };
