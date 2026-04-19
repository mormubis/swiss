/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Maximum-weight matching on general graphs — Edmonds' blossom algorithm.
 *
 * Faithful port of mwmatching.py by Joris van Rantwijk (2008), based on:
 *   "Efficient Algorithms for Finding Maximum Matching in Graphs"
 *   — Zvi Galil, ACM Computing Surveys, 1986.
 *
 * ## Algorithm overview
 *
 * A *matching* is a set of vertex-disjoint edges. A *maximum-weight matching*
 * maximises the sum of edge weights. Edmonds' algorithm finds one in O(n³).
 *
 * Key concepts:
 *
 * - **Augmenting path:** A path that starts and ends at unmatched vertices,
 *   alternating between non-matching and matching edges. Flipping all edges
 *   along such a path increases the matching size by one.
 *
 * - **Blossom:** An odd-length cycle where every other edge is in the
 *   matching. Blossoms are contracted into single "super-vertices" so the
 *   algorithm can find augmenting paths through odd cycles. Blossoms can nest
 *   (a blossom may contain other blossoms as children).
 *
 * - **Dual variables:** Each vertex and each non-trivial blossom carries a
 *   dual variable. The algorithm maintains *complementary slackness*: an edge
 *   (u,v) can only be in the matching if `dual[u] + dual[v] == weight(u,v)`
 *   (i.e. the edge is "tight"). Dual updates make new edges tight, driving
 *   the search forward.
 *
 * - **Labels (S / T):** During each stage the algorithm grows alternating
 *   trees from unmatched vertices. Vertices reachable by an even-length
 *   alternating path are labelled S (label=1); their matched partners are
 *   labelled T (label=2). Unlabelled vertices (label=0) are free.
 *
 * ## Main loop structure
 *
 * The algorithm runs at most `vertexCount` *stages*. Each stage attempts to
 * find one augmenting path and increase the matching size by one:
 *
 * 1. **Initialise labels:** Label all unmatched vertices as S.
 * 2. **Grow alternating trees (neighbor scan):** Process S-vertices from a
 *    queue. For each tight edge to a neighbor:
 *    - Free vertex → label it T, then label its match S (tree grows).
 *    - S-vertex in same tree → found an odd cycle → contract into a blossom.
 *    - S-vertex in different tree → found an augmenting path → augment.
 * 3. **Dual variable update:** If the queue is empty and no augmentation was
 *    found, compute the minimum adjustment (delta) that makes a new edge
 *    tight or allows a blossom to expand. There are four delta types:
 *    - Type 1: Minimum vertex dual (algorithm terminates).
 *    - Type 2: Edge from S-vertex to free vertex becomes tight.
 *    - Type 3: Edge between two S-blossoms becomes tight (halved slack).
 *    - Type 4: T-blossom dual reaches zero (expand the blossom).
 * 4. **Act on delta:** Make the edge tight / expand the blossom / terminate.
 * 5. **End-of-stage cleanup:** Expand any S-blossoms with zero dual.
 *
 * ## Endpoint encoding
 *
 * Edges are stored in a flat array where edge k has its two endpoint vertex
 * indices at positions `2k` and `2k+1`. The XOR trick `p ^ 1` flips between
 * the two endpoints of the same edge. This compact encoding avoids storing
 * separate "source" and "target" for each edge.
 *
 * ## Node indexing
 *
 * Vertices are numbered `0..vertexCount-1`. Blossoms are numbered
 * `vertexCount..2*vertexCount-1`. Arrays like `labels`, `dual`, `bestEdge`
 * are sized `2*vertexCount` to accommodate both vertices and blossoms in a
 * single flat array.
 *
 * Uses DynamicUint for arbitrary-precision non-negative weights.
 * Complexity: O(n³) where n is the number of vertices.
 *
 * The algorithm accesses pre-sized arrays by index throughout. All accesses
 * are within bounds by algorithm invariants; the non-null assertions are
 * intentional and safe.
 *
 * @internal Not part of the public API.
 */

import { DynamicUint } from './dynamic-uint.js';

function maxWeightMatching(
  edges: [number, number, DynamicUint][],
  maxCardinality = false,
): number[] {
  if (edges.length === 0) return [];

  // ── Dual variable precision ──
  // Dual variables must hold values up to 2× the maximum edge weight.
  // Compute the required word count from the input, then use closures
  // to allocate DynamicUint values at the correct capacity.
  let dualWords = 4;

  function dualZero(): DynamicUint {
    return DynamicUint.zero(dualWords);
  }

  function dualFrom(value: DynamicUint): DynamicUint {
    const result = DynamicUint.zero(dualWords);
    result.add(value);
    return result;
  }

  // Determine required word count: dual variables must hold 2× max edge weight.
  // Compute a temporary max first (words-agnostic), then set dualWords.
  let maxWords = 1;
  for (const edge of edges) {
    const weight = edge[2];
    if (weight.words > maxWords) maxWords = weight.words;
  }
  // Need capacity for dual[u] + dual[v] - 2*w: 2 extra words for overflow.
  dualWords = maxWords + 2;

  const ZERO = dualZero();

  const edgeCount = edges.length;
  let vertexCount = 0;
  for (const [u, v] of edges) {
    if (u >= vertexCount) vertexCount = u + 1;
    if (v >= vertexCount) vertexCount = v + 1;
  }

  let maxEdgeWeight: DynamicUint = ZERO.clone();
  for (const edge of edges) {
    const weight = edge[2];
    if (maxEdgeWeight.compareTo(weight) < 0) maxEdgeWeight = weight;
  }

  // ── Graph representation ──
  // `endpoints`: Flat endpoint array — edge k has vertex `endpoints[2k]` and
  // `endpoints[2k+1]`. The XOR trick (`p ^ 1`) gives the other endpoint of the
  // same edge without storing explicit source/target fields.
  const endpoints: number[] = Array.from({ length: 2 * edgeCount });
  for (let index = 0; index < edgeCount; index++) {
    endpoints[2 * index] = edges[index]![0];
    endpoints[2 * index + 1] = edges[index]![1];
  }

  // `neighborEdges`: Per-vertex list of endpoint indices for incident edges.
  // `neighborEdges[v]` contains endpoint indices pointing TO v's neighbors.
  // For edge k between u and v: `neighborEdges[u]` gets `2k+1` (points to v)
  // and `neighborEdges[v]` gets `2k` (points to u).
  const neighborEdges: number[][] = Array.from(
    { length: vertexCount },
    () => [],
  );
  for (let index = 0; index < edgeCount; index++) {
    const [u, v] = edges[index]!;
    neighborEdges[u]!.push(2 * index + 1);
    neighborEdges[v]!.push(2 * index);
  }

  // ── Matching state ──
  // `match[v]` = endpoint index of v's matched partner, or -1 if unmatched.
  // If `match[v] = p`, then v is matched to `endpoints[p]`.
  const match: number[] = Array.from({ length: vertexCount }, () => -1);

  // ── Labelling (alternating tree) ──
  // `labels[i]` = 0 (free/unlabelled), 1 (S-vertex), or 2 (T-vertex).
  // Indexed by both vertex IDs (0..vertexCount-1) and blossom IDs
  // (vertexCount..2*vertexCount-1).
  const labels: number[] = Array.from({ length: 2 * vertexCount }, () => 0);
  // `labelEndpoints[i]` = the endpoint index through which node i was reached
  // during tree-growing. -1 for root S-vertices (unmatched).
  const labelEndpoints: number[] = Array.from(
    { length: 2 * vertexCount },
    () => -1,
  );

  // ── Blossom structure ──
  // `vertexTopBlossom`: Maps vertex → its outermost (top-level) blossom.
  // Initially each vertex is its own trivial blossom (identity mapping).
  const vertexTopBlossom: number[] = Array.from(
    { length: vertexCount },
    (_, index) => index,
  );
  // `blossomParent`: Parent blossom in the blossom tree, or -1 if top-level.
  const blossomParent: number[] = Array.from(
    { length: 2 * vertexCount },
    () => -1,
  );
  // `blossomChildren`: Ordered list of sub-blossoms forming the odd cycle.
  // undefined for trivial (single-vertex) blossoms.
  const blossomChildren: (number[] | undefined)[] = Array.from({
    length: 2 * vertexCount,
  });
  // `blossomBase`: Base vertex of each blossom.
  // For trivial blossoms, `blossomBase[v] = v`. Non-trivial blossoms start as -1.
  const blossomBase: number[] = [
    ...Array.from({ length: vertexCount }, (_, index) => index),
    ...Array.from({ length: vertexCount }, () => -1),
  ];
  // `blossomEdgeEndpoints`: Endpoint indices connecting consecutive children in
  // the blossom cycle (parallel to `blossomChildren`).
  const blossomEdgeEndpoints: (number[] | undefined)[] = Array.from({
    length: 2 * vertexCount,
  });

  // ── Best-edge tracking ──
  // `bestEdge[i]`: Best edge (minimum slack) from node i to an S-blossom.
  // -1 if none known. Indexed over both vertices and blossoms.
  const bestEdge: number[] = Array.from({ length: 2 * vertexCount }, () => -1);
  // `blossomBestEdges[b]`: List of best edges from each of blossom b's
  // children to outside S-blossoms. Used when a blossom is contracted.
  const blossomBestEdges: (number[] | undefined)[] = Array.from({
    length: 2 * vertexCount,
  });

  // ── Blossom ID pool ──
  // `freeBlossom`: Stack of available non-trivial blossom IDs.
  // Pop to allocate a new blossom, push to recycle an expanded one.
  const freeBlossom: number[] = Array.from(
    { length: vertexCount },
    (_, index) => vertexCount + index,
  );

  // ── Dual variables ──
  // `dual[v]` for v < vertexCount: vertex dual, initialised to maxEdgeWeight.
  // `dual[b]` for b >= vertexCount: blossom dual, initialised to 0.
  const dual: DynamicUint[] = Array.from(
    { length: 2 * vertexCount },
    (_, index) => (index < vertexCount ? dualFrom(maxEdgeWeight) : dualZero()),
  );

  // ── Per-stage state ──
  // `edgeTight`: Whether edge k has zero slack (is "tight"). Reset each stage.
  const edgeTight: boolean[] = Array.from({ length: edgeCount }, () => false);
  // `queue`: S-labelled vertices whose neighbors have not yet been scanned.
  let queue: number[] = [];

  /**
   * Compute the slack of edge `edgeIdx`: dual[u] + dual[v] - 2*weight.
   * An edge is "tight" (eligible for matching) when its slack is zero.
   */
  function slack(edgeIndex: number): DynamicUint {
    const [u, v, weight] = edges[edgeIndex]!;
    // slack = dual[u] + dual[v] - 2*w
    return dual[u]!.clone().add(dual[v]!).subtract(weight.clone().shiftGrow(1));
  }

  /**
   * Yield all vertices (leaf nodes) contained in blossom `node`.
   * If `node` is a vertex (< vertexCount), yields just that vertex.
   * Otherwise, recursively descends through the blossom's children.
   */
  function* blossomLeaves(node: number): Generator<number> {
    if (node < vertexCount) yield node;
    else
      for (const child of blossomChildren[node]!) {
        if (child < vertexCount) yield child;
        else yield* blossomLeaves(child);
      }
  }

  /**
   * Assign label `labelType` (1=S or 2=T) to vertex `vertex` and its
   * top-level blossom, recording the endpoint that reached it.
   *
   * - S-label (1): All vertices in the blossom are added to the scan queue.
   * - T-label (2): The base vertex's mate is recursively labelled S,
   *   extending the alternating tree by one matched edge.
   */
  function assignLabel(
    vertex: number,
    labelType: number,
    endpointIndex: number,
  ): void {
    const blossom = vertexTopBlossom[vertex]!;
    labels[vertex] = labels[blossom] = labelType;
    labelEndpoints[vertex] = labelEndpoints[blossom] = endpointIndex;
    bestEdge[vertex] = bestEdge[blossom] = -1;
    if (labelType === 1) queue.push(...blossomLeaves(blossom));
    else if (labelType === 2) {
      const base = blossomBase[blossom]!;
      assignLabel(endpoints[match[base]!]!, 1, match[base]! ^ 1);
    }
  }

  /**
   * Trace back from two S-vertices (`vertexA` and `vertexB`) toward the
   * root of their alternating trees. If they share a common ancestor
   * (base vertex), a new blossom has been found — return that base.
   * If the paths reach two different roots, an augmenting path exists —
   * return -1.
   *
   * Uses label bit 4 as a visited marker (label=5 means "S + visited").
   * Restores labels to S (1) before returning.
   *
   * The two paths are interleaved: advance one cursor, then swap them,
   * so both paths are explored in lockstep.
   */
  function scanBlossom(vertexA: number, vertexB: number): number {
    const path: number[] = [];
    let base = -1,
      cursorA = vertexA,
      cursorB = vertexB;
    while (cursorA !== -1 || cursorB !== -1) {
      let blossom = vertexTopBlossom[cursorA === -1 ? cursorB : cursorA]!;
      if (labels[blossom]! & 4) {
        base = blossomBase[blossom]!;
        break;
      }
      path.push(blossom);
      labels[blossom] = 5;
      if (labelEndpoints[blossom] === -1) cursorA = -1;
      else {
        cursorA = endpoints[labelEndpoints[blossom]!]!;
        blossom = vertexTopBlossom[cursorA]!;
        cursorA = endpoints[labelEndpoints[blossom]!]!;
      }
      if (cursorB !== -1) {
        const swap = cursorA;
        cursorA = cursorB;
        cursorB = swap;
      }
    }
    for (const blossom of path) labels[blossom] = 1;
    return base;
  }

  /**
   * Create a new blossom from the odd cycle discovered by edge `edgeIndex`
   * connecting vertices in two branches that share base vertex `base`.
   *
   * Steps:
   * 1. Trace from both edge endpoints back to `base`, collecting the
   *    child blossoms and the endpoints connecting them into the cycle.
   * 2. Allocate a new blossom ID from `freeBlossom`.
   * 3. Reparent all children under the new blossom.
   * 4. Reassign all leaf vertices to the new blossom.
   * 5. Merge best-edge lists from all children to compute the new
   *    blossom's best edges to outside S-blossoms.
   */
  function addBlossom(base: number, edgeIndex: number): void {
    let [vertexU, vertexW] = edges[edgeIndex]!;
    const baseBlossom = vertexTopBlossom[base]!;
    let blossomU = vertexTopBlossom[vertexU]!,
      blossomW = vertexTopBlossom[vertexW]!;
    const newBlossom = freeBlossom.pop()!;
    blossomBase[newBlossom] = base;
    blossomParent[newBlossom] = -1;
    blossomParent[baseBlossom] = newBlossom;
    const path: number[] = [],
      cycleEndpoints: number[] = [];
    // Trace path from vertexU's blossom back to the base blossom.
    while (blossomU !== baseBlossom) {
      blossomParent[blossomU] = newBlossom;
      path.push(blossomU);
      cycleEndpoints.push(labelEndpoints[blossomU]!);
      vertexU = endpoints[labelEndpoints[blossomU]!]!;
      blossomU = vertexTopBlossom[vertexU]!;
    }
    path.push(baseBlossom);
    // Reverse so base blossom is at position 0 (cycle convention).
    path.reverse();
    cycleEndpoints.reverse();
    cycleEndpoints.push(2 * edgeIndex);
    // Trace path from vertexW's blossom forward (other half of cycle).
    while (blossomW !== baseBlossom) {
      blossomParent[blossomW] = newBlossom;
      path.push(blossomW);
      cycleEndpoints.push(labelEndpoints[blossomW]! ^ 1);
      vertexW = endpoints[labelEndpoints[blossomW]!]!;
      blossomW = vertexTopBlossom[vertexW]!;
    }
    labels[newBlossom] = 1;
    labelEndpoints[newBlossom] = labelEndpoints[baseBlossom]!;
    dual[newBlossom] = dualZero();
    blossomChildren[newBlossom] = path;
    blossomEdgeEndpoints[newBlossom] = cycleEndpoints;
    for (const leaf of blossomLeaves(newBlossom)) {
      if (labels[vertexTopBlossom[leaf]!] === 2) queue.push(leaf);
      vertexTopBlossom[leaf] = newBlossom;
    }
    const bestEdgeTo: number[] = Array.from(
      { length: 2 * vertexCount },
      () => -1,
    );
    // Merge best-edge lists from all children into the new blossom.
    for (const childBlossom of path) {
      let edgeLists: number[][];
      if (blossomBestEdges[childBlossom] === undefined) {
        edgeLists = [];
        for (const leaf of blossomLeaves(childBlossom))
          edgeLists.push(neighborEdges[leaf]!.map((ep) => ep >> 1));
      } else edgeLists = [blossomBestEdges[childBlossom]];
      for (const edgeList of edgeLists)
        for (const candidateEdge of edgeList) {
          const [endpointA, endpointB] = edges[candidateEdge]!;
          const outerVertex =
            vertexTopBlossom[endpointB] === newBlossom ? endpointA : endpointB;
          const outerBlossom = vertexTopBlossom[outerVertex]!;
          if (outerBlossom !== newBlossom && labels[outerBlossom] === 1) {
            const candidateSlack = slack(candidateEdge);
            if (
              bestEdgeTo[outerBlossom] === -1 ||
              candidateSlack.compareTo(slack(bestEdgeTo[outerBlossom]!)) < 0
            )
              bestEdgeTo[outerBlossom] = candidateEdge;
          }
        }
      blossomBestEdges[childBlossom] = undefined;
      bestEdge[childBlossom] = -1;
    }
    const collectedBestEdges: number[] = [];
    for (const candidateEdge of bestEdgeTo)
      if (candidateEdge !== -1) collectedBestEdges.push(candidateEdge);
    blossomBestEdges[newBlossom] = collectedBestEdges;
    bestEdge[newBlossom] = -1;
    for (const candidateEdge of collectedBestEdges) {
      const candidateSlack = slack(candidateEdge);
      if (
        bestEdge[newBlossom] === -1 ||
        candidateSlack.compareTo(slack(bestEdge[newBlossom]!)) < 0
      )
        bestEdge[newBlossom] = candidateEdge;
    }
  }

  /**
   * Expand (dissolve) blossom, restoring its children as independent nodes.
   *
   * Called in two contexts:
   * - `endstage=true`: End-of-stage cleanup. Recursively expand any
   *   zero-dual child blossoms. No relabelling needed.
   * - `endstage=false`: During a dual update (delta type 4) when a
   *   T-blossom's dual reaches zero. Must relabel the children to
   *   maintain alternating tree structure.
   *
   * The relabelling logic (when endstage=false and label=T):
   * 1. Find the "entry child" — the child through which the T-label
   *    entered the blossom.
   * 2. Walk the cycle in the direction that pairs children as T-S pairs.
   * 3. The `endptrick` parity variable handles direction-dependent
   *    flipping of endpoint indices.
   */
  function expandBlossom(blossom: number, endstage: boolean): void {
    for (const child of blossomChildren[blossom]!) {
      blossomParent[child] = -1;
      if (child < vertexCount) vertexTopBlossom[child] = child;
      else if (endstage && dual[child]!.isZero())
        expandBlossom(child, endstage);
      else
        for (const leaf of blossomLeaves(child)) vertexTopBlossom[leaf] = child;
    }
    if (!endstage && labels[blossom] === 2) {
      const entryChild =
        vertexTopBlossom[endpoints[labelEndpoints[blossom]! ^ 1]!]!;
      const children = blossomChildren[blossom]!,
        cycleEndpoints = blossomEdgeEndpoints[blossom]!;
      let index = children.indexOf(entryChild),
        jstep: number,
        endptrick: number;
      if (index & 1) {
        index -= children.length;
        jstep = 1;
        endptrick = 0;
      } else {
        jstep = -1;
        endptrick = 1;
      }
      let endpointIndex = labelEndpoints[blossom]!;
      while (index !== 0) {
        labels[endpoints[endpointIndex ^ 1]!] = 0;
        labels[
          endpoints[
            cycleEndpoints[
              (((index - endptrick) % children.length) + children.length) %
                children.length
            ]! ^
              endptrick ^
              1
          ]!
        ] = 0;
        assignLabel(endpoints[endpointIndex ^ 1]!, 2, endpointIndex);
        edgeTight[
          cycleEndpoints[
            (((index - endptrick) % children.length) + children.length) %
              children.length
          ]! >> 1
        ] = true;
        index += jstep;
        endpointIndex =
          cycleEndpoints[
            (((index - endptrick) % children.length) + children.length) %
              children.length
          ]! ^ endptrick;
        edgeTight[endpointIndex >> 1] = true;
        index += jstep;
      }
      const jmod =
        ((index % children.length) + children.length) % children.length;
      const childBlossom = children[jmod]!;
      labels[endpoints[endpointIndex ^ 1]!] = labels[childBlossom] = 2;
      labelEndpoints[endpoints[endpointIndex ^ 1]!] = labelEndpoints[
        childBlossom
      ] = endpointIndex;
      bestEdge[childBlossom] = -1;
      index += jstep;
      while (
        children[
          ((index % children.length) + children.length) % children.length
        ] !== entryChild
      ) {
        const jmod2 =
          ((index % children.length) + children.length) % children.length;
        const loopBlossom = children[jmod2]!;
        if (labels[loopBlossom] === 1) {
          index += jstep;
          continue;
        }
        let labeledVertex = -1;
        for (const leaf of blossomLeaves(loopBlossom)) {
          if (labels[leaf] !== 0) {
            labeledVertex = leaf;
            break;
          }
        }
        if (labeledVertex >= 0) {
          labels[labeledVertex] = 0;
          labels[endpoints[match[blossomBase[loopBlossom]!]!]!] = 0;
          assignLabel(labeledVertex, 2, labelEndpoints[labeledVertex]!);
        }
        index += jstep;
      }
    }
    labels[blossom] = labelEndpoints[blossom] = -1;
    blossomChildren[blossom] = blossomEdgeEndpoints[blossom] = undefined;
    blossomBase[blossom] = -1;
    blossomBestEdges[blossom] = undefined;
    bestEdge[blossom] = -1;
    freeBlossom.push(blossom);
  }

  /**
   * Update the matching inside `blossom` to reflect that `vertex` is now
   * matched to an external vertex.
   *
   * Rotates the blossom's internal matching so that `vertex`'s sub-blossom
   * becomes the new base (position 0 in the children array). Walks the
   * cycle from `vertex`'s position back to position 0, flipping
   * matched/unmatched edges along the way.
   *
   * If any child along the path is itself a non-trivial blossom,
   * recursively augments it too.
   */
  function augmentBlossom(blossom: number, vertex: number): void {
    let child = vertex;
    while (blossomParent[child]! !== blossom) child = blossomParent[child]!;
    if (child >= vertexCount) augmentBlossom(child, vertex);
    const children = blossomChildren[blossom]!,
      cycleEndpoints = blossomEdgeEndpoints[blossom]!;
    const index = children.indexOf(child);
    let indexStep = index,
      jstep: number,
      endptrick: number;
    if (index & 1) {
      indexStep -= children.length;
      jstep = 1;
      endptrick = 0;
    } else {
      jstep = -1;
      endptrick = 1;
    }
    while (indexStep !== 0) {
      indexStep += jstep;
      const jmod =
        ((indexStep % children.length) + children.length) % children.length;
      child = children[jmod]!;
      const epmod =
        (((indexStep - endptrick) % children.length) + children.length) %
        children.length;
      const endpointIndex = cycleEndpoints[epmod]! ^ endptrick;
      if (child >= vertexCount)
        augmentBlossom(child, endpoints[endpointIndex]!);
      indexStep += jstep;
      const jmod2 =
        ((indexStep % children.length) + children.length) % children.length;
      child = children[jmod2]!;
      if (child >= vertexCount)
        augmentBlossom(child, endpoints[endpointIndex ^ 1]!);
      match[endpoints[endpointIndex]!] = endpointIndex ^ 1;
      match[endpoints[endpointIndex ^ 1]!] = endpointIndex;
    }
    blossomChildren[blossom] = [
      ...children.slice(index),
      ...children.slice(0, index),
    ];
    blossomEdgeEndpoints[blossom] = [
      ...cycleEndpoints.slice(index),
      ...cycleEndpoints.slice(0, index),
    ];
    blossomBase[blossom] = blossomBase[children[index]!]!;
  }

  function augmentMatching(edgeIndex: number): void {
    const [vertexU, vertexW] = edges[edgeIndex]!;
    for (const [startVertex, startEndpoint] of [
      [vertexU, 2 * edgeIndex + 1],
      [vertexW, 2 * edgeIndex],
    ] as [number, number][]) {
      let vertex = startVertex,
        endpointIndex = startEndpoint;
      while (true) {
        const blossom = vertexTopBlossom[vertex]!;
        if (blossom >= vertexCount) augmentBlossom(blossom, vertex);
        match[vertex] = endpointIndex;
        if (labelEndpoints[blossom] === -1) break;
        const tVertex = endpoints[labelEndpoints[blossom]!]!;
        const tBlossom = vertexTopBlossom[tVertex]!;
        vertex = endpoints[labelEndpoints[tBlossom]!]!;
        const mateVertex = endpoints[labelEndpoints[tBlossom]! ^ 1]!;
        if (tBlossom >= vertexCount) augmentBlossom(tBlossom, mateVertex);
        match[mateVertex] = labelEndpoints[tBlossom]!;
        endpointIndex = labelEndpoints[tBlossom]! ^ 1;
      }
    }
  }

  for (let stage = 0; stage < vertexCount; stage++) {
    labels.fill(0);
    bestEdge.fill(-1);
    for (
      let blossomIndex = vertexCount;
      blossomIndex < 2 * vertexCount;
      blossomIndex++
    )
      blossomBestEdges[blossomIndex] = undefined;
    edgeTight.fill(false);
    queue = [];
    for (let v = 0; v < vertexCount; v++)
      if (match[v] === -1 && labels[vertexTopBlossom[v]!] === 0)
        assignLabel(v, 1, -1);
    let augmented = false;

    while (true) {
      while (queue.length > 0 && !augmented) {
        const vertex = queue.pop()!;
        for (const neighborEndpoint of neighborEdges[vertex]!) {
          const edgeIndex = neighborEndpoint >> 1,
            neighbor = endpoints[neighborEndpoint]!;
          if (vertexTopBlossom[vertex] === vertexTopBlossom[neighbor]) continue;
          let edgeSlack: DynamicUint | undefined;
          if (!edgeTight[edgeIndex]) {
            edgeSlack = slack(edgeIndex);
            if (edgeSlack.compareTo(ZERO) <= 0) edgeTight[edgeIndex] = true;
          }
          if (edgeTight[edgeIndex]) {
            if (labels[vertexTopBlossom[neighbor]!] === 0)
              assignLabel(neighbor, 2, neighborEndpoint ^ 1);
            else if (labels[vertexTopBlossom[neighbor]!] === 1) {
              const base = scanBlossom(vertex, neighbor);
              if (base >= 0) addBlossom(base, edgeIndex);
              else {
                augmentMatching(edgeIndex);
                augmented = true;
                break;
              }
            } else if (labels[neighbor] === 0) {
              labels[neighbor] = 2;
              labelEndpoints[neighbor] = neighborEndpoint ^ 1;
            }
          } else if (labels[vertexTopBlossom[neighbor]!] === 1) {
            const blossomIndex = vertexTopBlossom[vertex]!;
            if (
              bestEdge[blossomIndex] === -1 ||
              edgeSlack!.compareTo(slack(bestEdge[blossomIndex]!)) < 0
            )
              bestEdge[blossomIndex] = edgeIndex;
          } else if (
            labels[neighbor] === 0 &&
            (bestEdge[neighbor] === -1 ||
              edgeSlack!.compareTo(slack(bestEdge[neighbor]!)) < 0)
          )
            bestEdge[neighbor] = edgeIndex;
        }
      }
      if (augmented) break;

      let deltaType = -1,
        candidateDelta: DynamicUint = ZERO.clone(),
        deltaEdge = -1,
        deltaBlossom = -1;

      if (!maxCardinality) {
        deltaType = 1;
        candidateDelta = dual[0]!.clone();
        for (let v = 1; v < vertexCount; v++)
          if (dual[v]!.compareTo(candidateDelta) < 0)
            candidateDelta = dual[v]!.clone();
      }
      for (let v = 0; v < vertexCount; v++) {
        if (labels[vertexTopBlossom[v]!] === 0 && bestEdge[v] !== -1) {
          const candidateDeltaValue = slack(bestEdge[v]!);
          if (
            deltaType === -1 ||
            candidateDeltaValue.compareTo(candidateDelta) < 0
          ) {
            candidateDelta = candidateDeltaValue;
            deltaType = 2;
            deltaEdge = bestEdge[v]!;
          }
        }
      }
      for (
        let blossomIndex = 0;
        blossomIndex < 2 * vertexCount;
        blossomIndex++
      ) {
        if (
          blossomParent[blossomIndex] === -1 &&
          labels[blossomIndex] === 1 &&
          bestEdge[blossomIndex] !== -1
        ) {
          const candidateDeltaValue = slack(bestEdge[blossomIndex]!)
            .clone()
            .shiftRight(1);
          if (
            deltaType === -1 ||
            candidateDeltaValue.compareTo(candidateDelta) < 0
          ) {
            candidateDelta = candidateDeltaValue;
            deltaType = 3;
            deltaEdge = bestEdge[blossomIndex]!;
          }
        }
      }
      for (
        let blossomIndex = vertexCount;
        blossomIndex < 2 * vertexCount;
        blossomIndex++
      ) {
        if (
          blossomBase[blossomIndex]! >= 0 &&
          blossomParent[blossomIndex] === -1 &&
          labels[blossomIndex] === 2 &&
          (deltaType === -1 ||
            dual[blossomIndex]!.compareTo(candidateDelta) < 0)
        ) {
          candidateDelta = dual[blossomIndex]!.clone();
          deltaType = 4;
          deltaBlossom = blossomIndex;
        }
      }

      if (deltaType === -1) {
        if (maxCardinality) {
          deltaType = 1;
          candidateDelta = dual[0]!.clone();
          for (let v = 1; v < vertexCount; v++)
            if (dual[v]!.compareTo(candidateDelta) < 0)
              candidateDelta = dual[v]!.clone();
          if (candidateDelta.compareTo(ZERO) < 0) candidateDelta = ZERO.clone();
        } else break;
      }

      for (let v = 0; v < vertexCount; v++) {
        if (labels[vertexTopBlossom[v]!] === 1)
          dual[v]!.subtract(candidateDelta);
        else if (labels[vertexTopBlossom[v]!] === 2)
          dual[v]!.add(candidateDelta);
      }
      for (
        let blossomIndex = vertexCount;
        blossomIndex < 2 * vertexCount;
        blossomIndex++
      ) {
        if (
          blossomBase[blossomIndex]! >= 0 &&
          blossomParent[blossomIndex] === -1
        ) {
          if (labels[blossomIndex] === 1)
            dual[blossomIndex]!.add(candidateDelta);
          else if (labels[blossomIndex] === 2)
            dual[blossomIndex]!.subtract(candidateDelta);
        }
      }

      switch (deltaType) {
        case 1: {
          break;
        }
        case 2: {
          edgeTight[deltaEdge] = true;
          const [edgeU, edgeV] = edges[deltaEdge]!;
          const index = labels[vertexTopBlossom[edgeU]!] === 0 ? edgeV : edgeU;
          queue.push(index);
          break;
        }
        case 3: {
          edgeTight[deltaEdge] = true;
          queue.push(edges[deltaEdge]![0]);
          break;
        }
        case 4: {
          expandBlossom(deltaBlossom, false);
          break;
        }
        default: {
          break;
        }
      }

      if (deltaType === 1) break;
    }

    if (!augmented) break;

    for (
      let blossomIndex = vertexCount;
      blossomIndex < 2 * vertexCount;
      blossomIndex++
    ) {
      if (
        blossomParent[blossomIndex] === -1 &&
        blossomBase[blossomIndex]! >= 0 &&
        labels[blossomIndex] === 1 &&
        dual[blossomIndex]!.isZero()
      )
        expandBlossom(blossomIndex, true);
    }
  }

  const result: number[] = Array.from({ length: vertexCount }, () => -1);
  for (let v = 0; v < vertexCount; v++)
    if (match[v] !== -1) result[v] = endpoints[match[v]!]!;
  return result;
}

export { maxWeightMatching };
