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
 *    - Free vertex → label it T, then label its mate S (tree grows).
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

/**
 * Number of words pre-allocated for each dual variable.
 * Updated per invocation of maxWeightMatching based on the actual max edge
 * weight, ensuring dual variables can hold 2× the maximum edge weight plus
 * room for accumulated increments.
 */
let DUAL_WORDS = 4;

/** Returns a new DynamicUint zero with DUAL_WORDS capacity. */
function dualZero(): DynamicUint {
  return DynamicUint.zero(DUAL_WORDS);
}

/** Returns a new DynamicUint with DUAL_WORDS capacity, initialised to value. */
function dualFrom(value: DynamicUint): DynamicUint {
  const result = DynamicUint.zero(DUAL_WORDS);
  result.add(value);
  return result;
}

function maxWeightMatching(
  edges: [number, number, DynamicUint][],
  maxcardinality = false,
): number[] {
  if (edges.length === 0) return [];

  // Determine required word count: dual variables must hold 2× max edge weight.
  // Compute a temporary max first (words-agnostic), then set DUAL_WORDS.
  let maxWords = 1;
  for (const edge of edges) {
    const w = edge[2];
    if (w.words > maxWords) maxWords = w.words;
  }
  // Need capacity for dualvar[u] + dualvar[v] - 2*w: 2 extra words for overflow.
  DUAL_WORDS = maxWords + 2;

  const ZERO = dualZero();

  const nedge = edges.length;
  let nvertex = 0;
  for (const [index, index_] of edges) {
    if (index >= nvertex) nvertex = index + 1;
    if (index_ >= nvertex) nvertex = index_ + 1;
  }

  let maxweight: DynamicUint = ZERO.clone();
  for (const edge of edges) {
    const w = edge[2];
    if (maxweight.compareTo(w) < 0) maxweight = w;
  }

  const endpoint: number[] = Array.from({ length: 2 * nedge });
  for (let k = 0; k < nedge; k++) {
    endpoint[2 * k] = edges[k]![0];
    endpoint[2 * k + 1] = edges[k]![1];
  }

  const neighbend: number[][] = Array.from({ length: nvertex }, () => []);
  for (let k = 0; k < nedge; k++) {
    const [index, index_] = edges[k]!;
    neighbend[index]!.push(2 * k + 1);
    neighbend[index_]!.push(2 * k);
  }

  const mate: number[] = Array.from({ length: nvertex }, () => -1);
  const label: number[] = Array.from({ length: 2 * nvertex }, () => 0);
  const labelend: number[] = Array.from({ length: 2 * nvertex }, () => -1);
  const inblossom: number[] = Array.from(
    { length: nvertex },
    (_, index) => index,
  );
  const blossomparent: number[] = Array.from({ length: 2 * nvertex }, () => -1);
  const blossomchilds: (number[] | undefined)[] = Array.from({
    length: 2 * nvertex,
  });
  const blossombase: number[] = [
    ...Array.from({ length: nvertex }, (_, index) => index),
    ...Array.from({ length: nvertex }, () => -1),
  ];
  const blossomendps: (number[] | undefined)[] = Array.from({
    length: 2 * nvertex,
  });
  const bestedge: number[] = Array.from({ length: 2 * nvertex }, () => -1);
  const blossombestedges: (number[] | undefined)[] = Array.from({
    length: 2 * nvertex,
  });
  const unusedblossoms: number[] = Array.from(
    { length: nvertex },
    (_, index) => nvertex + index,
  );
  const dualvar: DynamicUint[] = Array.from(
    { length: 2 * nvertex },
    (_, index) => (index < nvertex ? dualFrom(maxweight) : dualZero()),
  );

  const allowedge: boolean[] = Array.from({ length: nedge }, () => false);
  let queue: number[] = [];

  function slack(k: number): DynamicUint {
    const [index, index_, wt] = edges[k]!;
    // slack = dualvar[u] + dualvar[v] - 2*w
    return dualvar[index]!.clone()
      .add(dualvar[index_]!)
      .subtract(wt.clone().shiftGrow(1));
  }

  function* blossomLeaves(b: number): Generator<number> {
    if (b < nvertex) yield b;
    else
      for (const t of blossomchilds[b]!) {
        if (t < nvertex) yield t;
        else yield* blossomLeaves(t);
      }
  }

  function assignLabel(w: number, t: number, p: number): void {
    const b = inblossom[w]!;
    label[w] = label[b] = t;
    labelend[w] = labelend[b] = p;
    bestedge[w] = bestedge[b] = -1;
    if (t === 1) queue.push(...blossomLeaves(b));
    else if (t === 2) {
      const base = blossombase[b]!;
      assignLabel(endpoint[mate[base]!]!, 1, mate[base]! ^ 1);
    }
  }

  function scanBlossom(v: number, w: number): number {
    const path: number[] = [];
    let base = -1,
      vv = v,
      ww = w;
    while (vv !== -1 || ww !== -1) {
      let b = inblossom[vv === -1 ? ww : vv]!;
      if (label[b]! & 4) {
        base = blossombase[b]!;
        break;
      }
      path.push(b);
      label[b] = 5;
      if (labelend[b] === -1) vv = -1;
      else {
        vv = endpoint[labelend[b]!]!;
        b = inblossom[vv]!;
        vv = endpoint[labelend[b]!]!;
      }
      if (ww !== -1) {
        const temporary = vv;
        vv = ww;
        ww = temporary;
      }
    }
    for (const b of path) label[b] = 1;
    return base;
  }

  function addBlossom(base: number, k: number): void {
    let [v, w] = edges[k]!;
    const bb = inblossom[base]!;
    let bv = inblossom[v]!,
      bw = inblossom[w]!;
    const b = unusedblossoms.pop()!;
    blossombase[b] = base;
    blossomparent[b] = -1;
    blossomparent[bb] = b;
    const path: number[] = [],
      endps: number[] = [];
    while (bv !== bb) {
      blossomparent[bv] = b;
      path.push(bv);
      endps.push(labelend[bv]!);
      v = endpoint[labelend[bv]!]!;
      bv = inblossom[v]!;
    }
    path.push(bb);
    path.reverse();
    endps.reverse();
    endps.push(2 * k);
    while (bw !== bb) {
      blossomparent[bw] = b;
      path.push(bw);
      endps.push(labelend[bw]! ^ 1);
      w = endpoint[labelend[bw]!]!;
      bw = inblossom[w]!;
    }
    label[b] = 1;
    labelend[b] = labelend[bb]!;
    dualvar[b] = dualZero();
    blossomchilds[b] = path;
    blossomendps[b] = endps;
    for (const vv of blossomLeaves(b)) {
      if (label[inblossom[vv]!] === 2) queue.push(vv);
      inblossom[vv] = b;
    }
    const bestedgeto: number[] = Array.from({ length: 2 * nvertex }, () => -1);
    for (const bvv of path) {
      let nblists: number[][];
      if (blossombestedges[bvv] === undefined) {
        nblists = [];
        for (const vv of blossomLeaves(bvv))
          nblists.push(neighbend[vv]!.map((pp) => pp >> 1));
      } else nblists = [blossombestedges[bvv]];
      for (const nblist of nblists)
        for (const kk of nblist) {
          const [iiRaw, jjRaw] = edges[kk]!;
          const jj = inblossom[jjRaw] === b ? iiRaw : jjRaw;
          const bj = inblossom[jj]!;
          if (bj !== b && label[bj] === 1) {
            const kkslack = slack(kk);
            if (
              bestedgeto[bj] === -1 ||
              kkslack.compareTo(slack(bestedgeto[bj]!)) < 0
            )
              bestedgeto[bj] = kk;
          }
        }
      blossombestedges[bvv] = undefined;
      bestedge[bvv] = -1;
    }
    const bestList: number[] = [];
    for (const kk of bestedgeto) if (kk !== -1) bestList.push(kk);
    blossombestedges[b] = bestList;
    bestedge[b] = -1;
    for (const kk of bestList) {
      const kkslack = slack(kk);
      if (bestedge[b] === -1 || kkslack.compareTo(slack(bestedge[b]!)) < 0)
        bestedge[b] = kk;
    }
  }

  function expandBlossom(b: number, endstage: boolean): void {
    for (const s of blossomchilds[b]!) {
      blossomparent[s] = -1;
      if (s < nvertex) inblossom[s] = s;
      else if (endstage && dualvar[s]!.isZero()) expandBlossom(s, endstage);
      else for (const vv of blossomLeaves(s)) inblossom[vv] = s;
    }
    if (!endstage && label[b] === 2) {
      const entrychild = inblossom[endpoint[labelend[b]! ^ 1]!]!;
      const childs = blossomchilds[b]!,
        endpsArray = blossomendps[b]!;
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
      let p = labelend[b]!;
      while (index !== 0) {
        label[endpoint[p ^ 1]!] = 0;
        label[
          endpoint[
            endpsArray[
              (((index - endptrick) % childs.length) + childs.length) %
                childs.length
            ]! ^
              endptrick ^
              1
          ]!
        ] = 0;
        assignLabel(endpoint[p ^ 1]!, 2, p);
        allowedge[
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
        allowedge[p >> 1] = true;
        index += jstep;
      }
      const jmod = ((index % childs.length) + childs.length) % childs.length;
      const bv = childs[jmod]!;
      label[endpoint[p ^ 1]!] = label[bv] = 2;
      labelend[endpoint[p ^ 1]!] = labelend[bv] = p;
      bestedge[bv] = -1;
      index += jstep;
      while (
        childs[((index % childs.length) + childs.length) % childs.length] !==
        entrychild
      ) {
        const jmod2 = ((index % childs.length) + childs.length) % childs.length;
        const bvv = childs[jmod2]!;
        if (label[bvv] === 1) {
          index += jstep;
          continue;
        }
        let foundV = -1;
        for (const vv of blossomLeaves(bvv)) {
          if (label[vv] !== 0) {
            foundV = vv;
            break;
          }
        }
        if (foundV >= 0) {
          label[foundV] = 0;
          label[endpoint[mate[blossombase[bvv]!]!]!] = 0;
          assignLabel(foundV, 2, labelend[foundV]!);
        }
        index += jstep;
      }
    }
    label[b] = labelend[b] = -1;
    blossomchilds[b] = blossomendps[b] = undefined;
    blossombase[b] = -1;
    blossombestedges[b] = undefined;
    bestedge[b] = -1;
    unusedblossoms.push(b);
  }

  function augmentBlossom(b: number, v: number): void {
    let t = v;
    while (blossomparent[t]! !== b) t = blossomparent[t]!;
    if (t >= nvertex) augmentBlossom(t, v);
    const childs = blossomchilds[b]!,
      endpsArray = blossomendps[b]!;
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
      if (t >= nvertex) augmentBlossom(t, endpoint[p]!);
      indexStep += jstep;
      const jmod2 =
        ((indexStep % childs.length) + childs.length) % childs.length;
      t = childs[jmod2]!;
      if (t >= nvertex) augmentBlossom(t, endpoint[p ^ 1]!);
      mate[endpoint[p]!] = p ^ 1;
      mate[endpoint[p ^ 1]!] = p;
    }
    blossomchilds[b] = [...childs.slice(index), ...childs.slice(0, index)];
    blossomendps[b] = [
      ...endpsArray.slice(index),
      ...endpsArray.slice(0, index),
    ];
    blossombase[b] = blossombase[childs[index]!]!;
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
        const bs = inblossom[s]!;
        if (bs >= nvertex) augmentBlossom(bs, s);
        mate[s] = p;
        if (labelend[bs] === -1) break;
        const t = endpoint[labelend[bs]!]!;
        const bt = inblossom[t]!;
        s = endpoint[labelend[bt]!]!;
        const index2 = endpoint[labelend[bt]! ^ 1]!;
        if (bt >= nvertex) augmentBlossom(bt, index2);
        mate[index2] = labelend[bt]!;
        p = labelend[bt]! ^ 1;
      }
    }
  }

  for (let _t = 0; _t < nvertex; _t++) {
    label.fill(0);
    bestedge.fill(-1);
    for (let bb = nvertex; bb < 2 * nvertex; bb++)
      blossombestedges[bb] = undefined;
    allowedge.fill(false);
    queue = [];
    for (let vv = 0; vv < nvertex; vv++)
      if (mate[vv] === -1 && label[inblossom[vv]!] === 0)
        assignLabel(vv, 1, -1);
    let augmented = false;

    while (true) {
      while (queue.length > 0 && !augmented) {
        const v = queue.pop()!;
        for (const p of neighbend[v]!) {
          const k = p >> 1,
            w = endpoint[p]!;
          if (inblossom[v] === inblossom[w]) continue;
          let kslack: DynamicUint | undefined;
          if (!allowedge[k]) {
            kslack = slack(k);
            if (kslack.compareTo(ZERO) <= 0) allowedge[k] = true;
          }
          if (allowedge[k]) {
            if (label[inblossom[w]!] === 0) assignLabel(w, 2, p ^ 1);
            else if (label[inblossom[w]!] === 1) {
              const base = scanBlossom(v, w);
              if (base >= 0) addBlossom(base, k);
              else {
                augmentMatching(k);
                augmented = true;
                break;
              }
            } else if (label[w] === 0) {
              label[w] = 2;
              labelend[w] = p ^ 1;
            }
          } else if (label[inblossom[w]!] === 1) {
            const bb = inblossom[v]!;
            if (
              bestedge[bb] === -1 ||
              kslack!.compareTo(slack(bestedge[bb]!)) < 0
            )
              bestedge[bb] = k;
          } else if (
            label[w] === 0 &&
            (bestedge[w] === -1 || kslack!.compareTo(slack(bestedge[w]!)) < 0)
          )
            bestedge[w] = k;
        }
      }
      if (augmented) break;

      let deltatype = -1,
        delta: DynamicUint = ZERO.clone(),
        deltaedge = -1,
        deltablossom = -1;

      if (!maxcardinality) {
        deltatype = 1;
        delta = dualvar[0]!.clone();
        for (let vv = 1; vv < nvertex; vv++)
          if (dualvar[vv]!.compareTo(delta) < 0) delta = dualvar[vv]!.clone();
      }
      for (let vv = 0; vv < nvertex; vv++) {
        if (label[inblossom[vv]!] === 0 && bestedge[vv] !== -1) {
          const d = slack(bestedge[vv]!);
          if (deltatype === -1 || d.compareTo(delta) < 0) {
            delta = d;
            deltatype = 2;
            deltaedge = bestedge[vv]!;
          }
        }
      }
      for (let bb = 0; bb < 2 * nvertex; bb++) {
        if (
          blossomparent[bb] === -1 &&
          label[bb] === 1 &&
          bestedge[bb] !== -1
        ) {
          const d = slack(bestedge[bb]!).clone().shiftRight(1);
          if (deltatype === -1 || d.compareTo(delta) < 0) {
            delta = d;
            deltatype = 3;
            deltaedge = bestedge[bb]!;
          }
        }
      }
      for (let bb = nvertex; bb < 2 * nvertex; bb++) {
        if (
          blossombase[bb]! >= 0 &&
          blossomparent[bb] === -1 &&
          label[bb] === 2 &&
          (deltatype === -1 || dualvar[bb]!.compareTo(delta) < 0)
        ) {
          delta = dualvar[bb]!.clone();
          deltatype = 4;
          deltablossom = bb;
        }
      }

      if (deltatype === -1) {
        if (maxcardinality) {
          deltatype = 1;
          delta = dualvar[0]!.clone();
          for (let vv = 1; vv < nvertex; vv++)
            if (dualvar[vv]!.compareTo(delta) < 0) delta = dualvar[vv]!.clone();
          if (delta.compareTo(ZERO) < 0) delta = ZERO.clone();
        } else break;
      }

      for (let vv = 0; vv < nvertex; vv++) {
        if (label[inblossom[vv]!] === 1) dualvar[vv]!.subtract(delta);
        else if (label[inblossom[vv]!] === 2) dualvar[vv]!.add(delta);
      }
      for (let bb = nvertex; bb < 2 * nvertex; bb++) {
        if (blossombase[bb]! >= 0 && blossomparent[bb] === -1) {
          if (label[bb] === 1) dualvar[bb]!.add(delta);
          else if (label[bb] === 2) dualvar[bb]!.subtract(delta);
        }
      }

      switch (deltatype) {
        case 1: {
          break;
        }
        case 2: {
          allowedge[deltaedge] = true;
          const [edgeU, edgeV] = edges[deltaedge]!;
          const index = label[inblossom[edgeU]!] === 0 ? edgeV : edgeU;
          queue.push(index);
          break;
        }
        case 3: {
          allowedge[deltaedge] = true;
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

    for (let bb = nvertex; bb < 2 * nvertex; bb++) {
      if (
        blossomparent[bb] === -1 &&
        blossombase[bb]! >= 0 &&
        label[bb] === 1 &&
        dualvar[bb]!.isZero()
      )
        expandBlossom(bb, true);
    }
  }

  const result: number[] = Array.from({ length: nvertex }, () => -1);
  for (let vv = 0; vv < nvertex; vv++)
    if (mate[vv] !== -1) result[vv] = endpoint[mate[vv]!]!;
  return result;
}

export { maxWeightMatching };
