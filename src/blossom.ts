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
  maxcardinality = false,
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
    const w = edge[2];
    if (w.words > maxWords) maxWords = w.words;
  }
  // Need capacity for dual[u] + dual[v] - 2*w: 2 extra words for overflow.
  dualWords = maxWords + 2;

  const ZERO = dualZero();

  const edgeCount = edges.length;
  let vertexCount = 0;
  for (const [index, index_] of edges) {
    if (index >= vertexCount) vertexCount = index + 1;
    if (index_ >= vertexCount) vertexCount = index_ + 1;
  }

  let maxEdgeWeight: DynamicUint = ZERO.clone();
  for (const edge of edges) {
    const w = edge[2];
    if (maxEdgeWeight.compareTo(w) < 0) maxEdgeWeight = w;
  }

  const endpoints: number[] = Array.from({ length: 2 * edgeCount });
  for (let k = 0; k < edgeCount; k++) {
    endpoints[2 * k] = edges[k]![0];
    endpoints[2 * k + 1] = edges[k]![1];
  }

  const neighborEdges: number[][] = Array.from(
    { length: vertexCount },
    () => [],
  );
  for (let k = 0; k < edgeCount; k++) {
    const [index, index_] = edges[k]!;
    neighborEdges[index]!.push(2 * k + 1);
    neighborEdges[index_]!.push(2 * k);
  }

  const match: number[] = Array.from({ length: vertexCount }, () => -1);
  const labels: number[] = Array.from({ length: 2 * vertexCount }, () => 0);
  const labelEndpoints: number[] = Array.from(
    { length: 2 * vertexCount },
    () => -1,
  );
  const vertexTopBlossom: number[] = Array.from(
    { length: vertexCount },
    (_, index) => index,
  );
  const blossomParent: number[] = Array.from(
    { length: 2 * vertexCount },
    () => -1,
  );
  const blossomChildren: (number[] | undefined)[] = Array.from({
    length: 2 * vertexCount,
  });
  const blossomBase: number[] = [
    ...Array.from({ length: vertexCount }, (_, index) => index),
    ...Array.from({ length: vertexCount }, () => -1),
  ];
  const blossomEdgeEndpoints: (number[] | undefined)[] = Array.from({
    length: 2 * vertexCount,
  });
  const bestEdge: number[] = Array.from({ length: 2 * vertexCount }, () => -1);
  const blossomBestEdges: (number[] | undefined)[] = Array.from({
    length: 2 * vertexCount,
  });
  const freeBlossom: number[] = Array.from(
    { length: vertexCount },
    (_, index) => vertexCount + index,
  );
  const dual: DynamicUint[] = Array.from(
    { length: 2 * vertexCount },
    (_, index) => (index < vertexCount ? dualFrom(maxEdgeWeight) : dualZero()),
  );

  const edgeTight: boolean[] = Array.from({ length: edgeCount }, () => false);
  let queue: number[] = [];

  function slack(k: number): DynamicUint {
    const [index, index_, wt] = edges[k]!;
    // slack = dual[u] + dual[v] - 2*w
    return dual[index]!.clone()
      .add(dual[index_]!)
      .subtract(wt.clone().shiftGrow(1));
  }

  function* blossomLeaves(b: number): Generator<number> {
    if (b < vertexCount) yield b;
    else
      for (const t of blossomChildren[b]!) {
        if (t < vertexCount) yield t;
        else yield* blossomLeaves(t);
      }
  }

  function assignLabel(w: number, t: number, p: number): void {
    const b = vertexTopBlossom[w]!;
    labels[w] = labels[b] = t;
    labelEndpoints[w] = labelEndpoints[b] = p;
    bestEdge[w] = bestEdge[b] = -1;
    if (t === 1) queue.push(...blossomLeaves(b));
    else if (t === 2) {
      const base = blossomBase[b]!;
      assignLabel(endpoints[match[base]!]!, 1, match[base]! ^ 1);
    }
  }

  function scanBlossom(v: number, w: number): number {
    const path: number[] = [];
    let base = -1,
      vv = v,
      ww = w;
    while (vv !== -1 || ww !== -1) {
      let b = vertexTopBlossom[vv === -1 ? ww : vv]!;
      if (labels[b]! & 4) {
        base = blossomBase[b]!;
        break;
      }
      path.push(b);
      labels[b] = 5;
      if (labelEndpoints[b] === -1) vv = -1;
      else {
        vv = endpoints[labelEndpoints[b]!]!;
        b = vertexTopBlossom[vv]!;
        vv = endpoints[labelEndpoints[b]!]!;
      }
      if (ww !== -1) {
        const temporary = vv;
        vv = ww;
        ww = temporary;
      }
    }
    for (const b of path) labels[b] = 1;
    return base;
  }

  function addBlossom(base: number, k: number): void {
    let [v, w] = edges[k]!;
    const bb = vertexTopBlossom[base]!;
    let bv = vertexTopBlossom[v]!,
      bw = vertexTopBlossom[w]!;
    const b = freeBlossom.pop()!;
    blossomBase[b] = base;
    blossomParent[b] = -1;
    blossomParent[bb] = b;
    const path: number[] = [],
      endps: number[] = [];
    while (bv !== bb) {
      blossomParent[bv] = b;
      path.push(bv);
      endps.push(labelEndpoints[bv]!);
      v = endpoints[labelEndpoints[bv]!]!;
      bv = vertexTopBlossom[v]!;
    }
    path.push(bb);
    path.reverse();
    endps.reverse();
    endps.push(2 * k);
    while (bw !== bb) {
      blossomParent[bw] = b;
      path.push(bw);
      endps.push(labelEndpoints[bw]! ^ 1);
      w = endpoints[labelEndpoints[bw]!]!;
      bw = vertexTopBlossom[w]!;
    }
    labels[b] = 1;
    labelEndpoints[b] = labelEndpoints[bb]!;
    dual[b] = dualZero();
    blossomChildren[b] = path;
    blossomEdgeEndpoints[b] = endps;
    for (const vv of blossomLeaves(b)) {
      if (labels[vertexTopBlossom[vv]!] === 2) queue.push(vv);
      vertexTopBlossom[vv] = b;
    }
    const bestEdgeTo: number[] = Array.from(
      { length: 2 * vertexCount },
      () => -1,
    );
    for (const bvv of path) {
      let nblists: number[][];
      if (blossomBestEdges[bvv] === undefined) {
        nblists = [];
        for (const vv of blossomLeaves(bvv))
          nblists.push(neighborEdges[vv]!.map((pp) => pp >> 1));
      } else nblists = [blossomBestEdges[bvv]];
      for (const nblist of nblists)
        for (const kk of nblist) {
          const [iiRaw, jjRaw] = edges[kk]!;
          const jj = vertexTopBlossom[jjRaw] === b ? iiRaw : jjRaw;
          const bj = vertexTopBlossom[jj]!;
          if (bj !== b && labels[bj] === 1) {
            const kkslack = slack(kk);
            if (
              bestEdgeTo[bj] === -1 ||
              kkslack.compareTo(slack(bestEdgeTo[bj]!)) < 0
            )
              bestEdgeTo[bj] = kk;
          }
        }
      blossomBestEdges[bvv] = undefined;
      bestEdge[bvv] = -1;
    }
    const bestList: number[] = [];
    for (const kk of bestEdgeTo) if (kk !== -1) bestList.push(kk);
    blossomBestEdges[b] = bestList;
    bestEdge[b] = -1;
    for (const kk of bestList) {
      const kkslack = slack(kk);
      if (bestEdge[b] === -1 || kkslack.compareTo(slack(bestEdge[b]!)) < 0)
        bestEdge[b] = kk;
    }
  }

  function expandBlossom(b: number, endstage: boolean): void {
    for (const s of blossomChildren[b]!) {
      blossomParent[s] = -1;
      if (s < vertexCount) vertexTopBlossom[s] = s;
      else if (endstage && dual[s]!.isZero()) expandBlossom(s, endstage);
      else for (const vv of blossomLeaves(s)) vertexTopBlossom[vv] = s;
    }
    if (!endstage && labels[b] === 2) {
      const entrychild = vertexTopBlossom[endpoints[labelEndpoints[b]! ^ 1]!]!;
      const childs = blossomChildren[b]!,
        endpsArray = blossomEdgeEndpoints[b]!;
      let index = childs.indexOf(entrychild),
        jstep: number,
        endptrick: number;
      if (index & 1) {
        index -= childs.length;
        jstep = 1;
        endptrick = 0;
      } else {
        jstep = -1;
        endptrick = 1;
      }
      let p = labelEndpoints[b]!;
      while (index !== 0) {
        labels[endpoints[p ^ 1]!] = 0;
        labels[
          endpoints[
            endpsArray[
              (((index - endptrick) % childs.length) + childs.length) %
                childs.length
            ]! ^
              endptrick ^
              1
          ]!
        ] = 0;
        assignLabel(endpoints[p ^ 1]!, 2, p);
        edgeTight[
          endpsArray[
            (((index - endptrick) % childs.length) + childs.length) %
              childs.length
          ]! >> 1
        ] = true;
        index += jstep;
        p =
          endpsArray[
            (((index - endptrick) % childs.length) + childs.length) %
              childs.length
          ]! ^ endptrick;
        edgeTight[p >> 1] = true;
        index += jstep;
      }
      const jmod = ((index % childs.length) + childs.length) % childs.length;
      const bv = childs[jmod]!;
      labels[endpoints[p ^ 1]!] = labels[bv] = 2;
      labelEndpoints[endpoints[p ^ 1]!] = labelEndpoints[bv] = p;
      bestEdge[bv] = -1;
      index += jstep;
      while (
        childs[((index % childs.length) + childs.length) % childs.length] !==
        entrychild
      ) {
        const jmod2 = ((index % childs.length) + childs.length) % childs.length;
        const bvv = childs[jmod2]!;
        if (labels[bvv] === 1) {
          index += jstep;
          continue;
        }
        let foundV = -1;
        for (const vv of blossomLeaves(bvv)) {
          if (labels[vv] !== 0) {
            foundV = vv;
            break;
          }
        }
        if (foundV >= 0) {
          labels[foundV] = 0;
          labels[endpoints[match[blossomBase[bvv]!]!]!] = 0;
          assignLabel(foundV, 2, labelEndpoints[foundV]!);
        }
        index += jstep;
      }
    }
    labels[b] = labelEndpoints[b] = -1;
    blossomChildren[b] = blossomEdgeEndpoints[b] = undefined;
    blossomBase[b] = -1;
    blossomBestEdges[b] = undefined;
    bestEdge[b] = -1;
    freeBlossom.push(b);
  }

  function augmentBlossom(b: number, v: number): void {
    let t = v;
    while (blossomParent[t]! !== b) t = blossomParent[t]!;
    if (t >= vertexCount) augmentBlossom(t, v);
    const childs = blossomChildren[b]!,
      endpsArray = blossomEdgeEndpoints[b]!;
    const index = childs.indexOf(t);
    let indexStep = index,
      jstep: number,
      endptrick: number;
    if (index & 1) {
      indexStep -= childs.length;
      jstep = 1;
      endptrick = 0;
    } else {
      jstep = -1;
      endptrick = 1;
    }
    while (indexStep !== 0) {
      indexStep += jstep;
      const jmod =
        ((indexStep % childs.length) + childs.length) % childs.length;
      t = childs[jmod]!;
      const epmod =
        (((indexStep - endptrick) % childs.length) + childs.length) %
        childs.length;
      const p = endpsArray[epmod]! ^ endptrick;
      if (t >= vertexCount) augmentBlossom(t, endpoints[p]!);
      indexStep += jstep;
      const jmod2 =
        ((indexStep % childs.length) + childs.length) % childs.length;
      t = childs[jmod2]!;
      if (t >= vertexCount) augmentBlossom(t, endpoints[p ^ 1]!);
      match[endpoints[p]!] = p ^ 1;
      match[endpoints[p ^ 1]!] = p;
    }
    blossomChildren[b] = [...childs.slice(index), ...childs.slice(0, index)];
    blossomEdgeEndpoints[b] = [
      ...endpsArray.slice(index),
      ...endpsArray.slice(0, index),
    ];
    blossomBase[b] = blossomBase[childs[index]!]!;
  }

  function augmentMatching(k: number): void {
    const [v, w] = edges[k]!;
    for (const [s0, p0] of [
      [v, 2 * k + 1],
      [w, 2 * k],
    ] as [number, number][]) {
      let s = s0,
        p = p0;
      while (true) {
        const bs = vertexTopBlossom[s]!;
        if (bs >= vertexCount) augmentBlossom(bs, s);
        match[s] = p;
        if (labelEndpoints[bs] === -1) break;
        const t = endpoints[labelEndpoints[bs]!]!;
        const bt = vertexTopBlossom[t]!;
        s = endpoints[labelEndpoints[bt]!]!;
        const index2 = endpoints[labelEndpoints[bt]! ^ 1]!;
        if (bt >= vertexCount) augmentBlossom(bt, index2);
        match[index2] = labelEndpoints[bt]!;
        p = labelEndpoints[bt]! ^ 1;
      }
    }
  }

  for (let _t = 0; _t < vertexCount; _t++) {
    labels.fill(0);
    bestEdge.fill(-1);
    for (let bb = vertexCount; bb < 2 * vertexCount; bb++)
      blossomBestEdges[bb] = undefined;
    edgeTight.fill(false);
    queue = [];
    for (let vv = 0; vv < vertexCount; vv++)
      if (match[vv] === -1 && labels[vertexTopBlossom[vv]!] === 0)
        assignLabel(vv, 1, -1);
    let augmented = false;

    while (true) {
      while (queue.length > 0 && !augmented) {
        const v = queue.pop()!;
        for (const p of neighborEdges[v]!) {
          const k = p >> 1,
            w = endpoints[p]!;
          if (vertexTopBlossom[v] === vertexTopBlossom[w]) continue;
          let kslack: DynamicUint | undefined;
          if (!edgeTight[k]) {
            kslack = slack(k);
            if (kslack.compareTo(ZERO) <= 0) edgeTight[k] = true;
          }
          if (edgeTight[k]) {
            if (labels[vertexTopBlossom[w]!] === 0) assignLabel(w, 2, p ^ 1);
            else if (labels[vertexTopBlossom[w]!] === 1) {
              const base = scanBlossom(v, w);
              if (base >= 0) addBlossom(base, k);
              else {
                augmentMatching(k);
                augmented = true;
                break;
              }
            } else if (labels[w] === 0) {
              labels[w] = 2;
              labelEndpoints[w] = p ^ 1;
            }
          } else if (labels[vertexTopBlossom[w]!] === 1) {
            const bb = vertexTopBlossom[v]!;
            if (
              bestEdge[bb] === -1 ||
              kslack!.compareTo(slack(bestEdge[bb]!)) < 0
            )
              bestEdge[bb] = k;
          } else if (
            labels[w] === 0 &&
            (bestEdge[w] === -1 || kslack!.compareTo(slack(bestEdge[w]!)) < 0)
          )
            bestEdge[w] = k;
        }
      }
      if (augmented) break;

      let deltatype = -1,
        delta: DynamicUint = ZERO.clone(),
        deltaedge = -1,
        deltablossom = -1;

      if (!maxcardinality) {
        deltatype = 1;
        delta = dual[0]!.clone();
        for (let vv = 1; vv < vertexCount; vv++)
          if (dual[vv]!.compareTo(delta) < 0) delta = dual[vv]!.clone();
      }
      for (let vv = 0; vv < vertexCount; vv++) {
        if (labels[vertexTopBlossom[vv]!] === 0 && bestEdge[vv] !== -1) {
          const d = slack(bestEdge[vv]!);
          if (deltatype === -1 || d.compareTo(delta) < 0) {
            delta = d;
            deltatype = 2;
            deltaedge = bestEdge[vv]!;
          }
        }
      }
      for (let bb = 0; bb < 2 * vertexCount; bb++) {
        if (
          blossomParent[bb] === -1 &&
          labels[bb] === 1 &&
          bestEdge[bb] !== -1
        ) {
          const d = slack(bestEdge[bb]!).clone().shiftRight(1);
          if (deltatype === -1 || d.compareTo(delta) < 0) {
            delta = d;
            deltatype = 3;
            deltaedge = bestEdge[bb]!;
          }
        }
      }
      for (let bb = vertexCount; bb < 2 * vertexCount; bb++) {
        if (
          blossomBase[bb]! >= 0 &&
          blossomParent[bb] === -1 &&
          labels[bb] === 2 &&
          (deltatype === -1 || dual[bb]!.compareTo(delta) < 0)
        ) {
          delta = dual[bb]!.clone();
          deltatype = 4;
          deltablossom = bb;
        }
      }

      if (deltatype === -1) {
        if (maxcardinality) {
          deltatype = 1;
          delta = dual[0]!.clone();
          for (let vv = 1; vv < vertexCount; vv++)
            if (dual[vv]!.compareTo(delta) < 0) delta = dual[vv]!.clone();
          if (delta.compareTo(ZERO) < 0) delta = ZERO.clone();
        } else break;
      }

      for (let vv = 0; vv < vertexCount; vv++) {
        if (labels[vertexTopBlossom[vv]!] === 1) dual[vv]!.subtract(delta);
        else if (labels[vertexTopBlossom[vv]!] === 2) dual[vv]!.add(delta);
      }
      for (let bb = vertexCount; bb < 2 * vertexCount; bb++) {
        if (blossomBase[bb]! >= 0 && blossomParent[bb] === -1) {
          if (labels[bb] === 1) dual[bb]!.add(delta);
          else if (labels[bb] === 2) dual[bb]!.subtract(delta);
        }
      }

      switch (deltatype) {
        case 1: {
          break;
        }
        case 2: {
          edgeTight[deltaedge] = true;
          const [edgeU, edgeV] = edges[deltaedge]!;
          const index = labels[vertexTopBlossom[edgeU]!] === 0 ? edgeV : edgeU;
          queue.push(index);
          break;
        }
        case 3: {
          edgeTight[deltaedge] = true;
          queue.push(edges[deltaedge]![0]);
          break;
        }
        case 4: {
          expandBlossom(deltablossom, false);
          break;
        }
        default: {
          break;
        }
      }

      if (deltatype === 1) break;
    }

    if (!augmented) break;

    for (let bb = vertexCount; bb < 2 * vertexCount; bb++) {
      if (
        blossomParent[bb] === -1 &&
        blossomBase[bb]! >= 0 &&
        labels[bb] === 1 &&
        dual[bb]!.isZero()
      )
        expandBlossom(bb, true);
    }
  }

  const result: number[] = Array.from({ length: vertexCount }, () => -1);
  for (let vv = 0; vv < vertexCount; vv++)
    if (match[vv] !== -1) result[vv] = endpoints[match[vv]!]!;
  return result;
}

export { maxWeightMatching };
