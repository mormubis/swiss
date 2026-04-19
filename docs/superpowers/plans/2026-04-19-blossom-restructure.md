# Blossom Algorithm Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `blossom.ts` for maintainability — rename all variables to
descriptive names, extract the main loop into named functions, add thorough
inline documentation, and encapsulate mutable module-level state.

**Architecture:** Pure refactor of a single file. No algorithm changes, no API
changes, no consumer changes. The existing 20 test cases in `blossom.spec.ts`
are the safety net — every commit must keep them green.

**Tech Stack:** TypeScript (strict, ESM-only), Vitest for tests.

**GitHub Issue:** https://github.com/echecsjs/swiss/issues/6

---

## File Structure

```
src/
  blossom.ts    # RESTRUCTURE: rename vars, extract functions, add docs
```

No new files. No other files modified.

---

## Naming Reference

This table maps every old variable name to its new name. All tasks reference
this table — if a step says "rename per the naming table", use this.

### Data structure arrays

| Old                | New                    | Purpose                                             |
| ------------------ | ---------------------- | --------------------------------------------------- |
| `nedge`            | `edgeCount`            | Total number of edges                               |
| `nvertex`          | `vertexCount`          | Total number of vertices                            |
| `endpoint`         | `endpoints`            | Flat array: edge k has endpoints at [2k] and [2k+1] |
| `neighbend`        | `neighborEdges`        | Per-vertex list of incident endpoint indices        |
| `mate`             | `match`                | Per-vertex matched endpoint index (-1 = unmatched)  |
| `label`            | `labels`               | Per-node label: 0=free, 1=S, 2=T                    |
| `labelend`         | `labelEndpoints`       | Per-node endpoint index that led to this label      |
| `inblossom`        | `vertexTopBlossom`     | Maps vertex → its outermost (top-level) blossom     |
| `blossomparent`    | `blossomParent`        | Parent blossom in the blossom tree (-1 = top-level) |
| `blossomchilds`    | `blossomChildren`      | Ordered list of child sub-blossoms                  |
| `blossombase`      | `blossomBase`          | Base vertex of each blossom                         |
| `blossomendps`     | `blossomEdgeEndpoints` | Endpoint indices connecting children in the cycle   |
| `bestedge`         | `bestEdge`             | Best edge to an S-blossom for each node             |
| `blossombestedges` | `blossomBestEdges`     | List of best edges for each blossom                 |
| `unusedblossoms`   | `freeBlossom`          | Stack of available blossom IDs                      |
| `dualvar`          | `dual`                 | Dual variables: vertex duals and blossom duals      |
| `allowedge`        | `edgeTight`            | Whether edge has zero slack (is "tight")            |
| `maxweight`        | `maxEdgeWeight`        | Maximum edge weight in the input                    |
| `ZERO`             | `ZERO`                 | Constant zero DynamicUint (unchanged)               |

### Function parameters and locals

| Context             | Old             | New                          |
| ------------------- | --------------- | ---------------------------- |
| `slack()`           | `k`             | `edgeIdx`                    |
| `slack()`           | `index, index_` | `u, v`                       |
| `slack()`           | `wt`            | `weight`                     |
| `blossomLeaves()`   | `b`             | `node`                       |
| `blossomLeaves()`   | `t`             | `child`                      |
| `assignLabel()`     | `w`             | `vertex`                     |
| `assignLabel()`     | `t`             | `labelType`                  |
| `assignLabel()`     | `p`             | `endpointIdx`                |
| `assignLabel()`     | `b`             | `blossom`                    |
| `scanBlossom()`     | `v, w`          | `vertexA, vertexB`           |
| `scanBlossom()`     | `vv, ww`        | `cursorA, cursorB`           |
| `scanBlossom()`     | `b`             | `blossom`                    |
| `addBlossom()`      | `k`             | `edgeIdx`                    |
| `addBlossom()`      | `v, w`          | `vertexU, vertexW`           |
| `addBlossom()`      | `bb`            | `baseBlossom`                |
| `addBlossom()`      | `bv, bw`        | `blossomU, blossomW`         |
| `addBlossom()`      | `b`             | `newBlossom`                 |
| `addBlossom()`      | `endps`         | `edgeEndpoints`              |
| `addBlossom()`      | `bvv`           | `childBlossom`               |
| `addBlossom()`      | `kk`            | `candidateEdge`              |
| `addBlossom()`      | `iiRaw, jjRaw`  | `endpointA, endpointB`       |
| `addBlossom()`      | `jj`            | `outerVertex`                |
| `addBlossom()`      | `bj`            | `outerBlossom`               |
| `addBlossom()`      | `kkslack`       | `candidateSlack`             |
| `addBlossom()`      | `bestedgeto`    | `bestEdgeTo`                 |
| `addBlossom()`      | `nblists`       | `edgeLists`                  |
| `addBlossom()`      | `nblist`        | `edgeList`                   |
| `addBlossom()`      | `bestList`      | `collectedBestEdges`         |
| `expandBlossom()`   | `b`             | `blossom`                    |
| `expandBlossom()`   | `s`             | `child`                      |
| `expandBlossom()`   | `entrychild`    | `entryChild`                 |
| `expandBlossom()`   | `childs`        | `children`                   |
| `expandBlossom()`   | `endpsArray`    | `edgeEndpoints`              |
| `expandBlossom()`   | `p`             | `endpointIdx`                |
| `expandBlossom()`   | `bv`            | `childBlossom`               |
| `expandBlossom()`   | `bvv`           | `loopBlossom`                |
| `expandBlossom()`   | `foundV`        | `labeledVertex`              |
| `augmentBlossom()`  | `b`             | `blossom`                    |
| `augmentBlossom()`  | `v`             | `vertex`                     |
| `augmentBlossom()`  | `t`             | `child`                      |
| `augmentBlossom()`  | `childs`        | `children`                   |
| `augmentBlossom()`  | `endpsArray`    | `edgeEndpoints`              |
| `augmentBlossom()`  | `p`             | `endpointIdx`                |
| `augmentMatching()` | `k`             | `edgeIdx`                    |
| `augmentMatching()` | `v, w`          | `vertexU, vertexW`           |
| `augmentMatching()` | `s0, p0`        | `startVertex, startEndpoint` |
| `augmentMatching()` | `s, p`          | `vertex, endpointIdx`        |
| `augmentMatching()` | `bs`            | `blossom`                    |
| `augmentMatching()` | `t`             | `tVertex`                    |
| `augmentMatching()` | `bt`            | `tBlossom`                   |
| `augmentMatching()` | `index2`        | `mateVertex`                 |
| Main loop           | `_t`            | `stage`                      |
| Main loop           | `v`             | `vertex`                     |
| Main loop           | `p`             | `neighborEndpoint`           |
| Main loop           | `k`             | `edgeIdx`                    |
| Main loop           | `w`             | `neighbor`                   |
| Main loop           | `kslack`        | `edgeSlack`                  |
| Main loop           | `bb`            | `blossomIdx`                 |
| Delta computation   | `deltatype`     | `deltaType`                  |
| Delta computation   | `deltaedge`     | `deltaEdge`                  |
| Delta computation   | `deltablossom`  | `deltaBlossom`               |
| Delta computation   | `d`             | `candidateDelta`             |

---

## Task 1: Expand module-level docstring

**Files:**

- Modify: `src/blossom.ts:1-18`

Documentation-only change. No code modification.

- [ ] **Step 1: Replace the top-of-file comment**

Replace lines 1-18 with:

```typescript
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
```

- [ ] **Step 2: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 3: Commit**

```bash
git add src/blossom.ts
git commit -m "docs(blossom): expand module-level algorithm overview"
```

---

## Task 2: Encapsulate module-level mutable state

**Files:**

- Modify: `src/blossom.ts:20-40` (move into function body)
- Modify: `src/blossom.ts:42-56` (adjust references)

Move `DUAL_WORDS`, `dualZero()`, and `dualFrom()` from module scope into the
body of `maxWeightMatching`. They become a local `let` and two local closures.

- [ ] **Step 1: Delete module-scope declarations**

Remove the module-scope `let DUAL_WORDS = 4`, `function dualZero()`, and
`function dualFrom()` (the block between the `import` line and
`function maxWeightMatching`).

- [ ] **Step 2: Add them as locals inside maxWeightMatching**

At the top of `maxWeightMatching`, after `if (edges.length === 0) return [];`,
add:

```typescript
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
```

- [ ] **Step 3: Update the word-count computation**

Change the existing `DUAL_WORDS = maxWords + 2` assignment to
`dualWords = maxWords + 2`.

- [ ] **Step 4: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 5: Commit**

```bash
git add src/blossom.ts
git commit -m "refactor(blossom): encapsulate DUAL_WORDS inside maxWeightMatching"
```

---

## Task 3: Rename data structure arrays

**Files:**

- Modify: `src/blossom.ts` (throughout — use find-and-replace)

Rename all data structure arrays per the naming table. This is a mechanical
rename — no logic changes. Do these renames in one pass to avoid partial states.
Use the editor's rename/replaceAll functionality.

Renames (in order of application to avoid collisions):

1. `blossombestedges` → `blossomBestEdges` (do first — longest prefix)
2. `blossomendps` → `blossomEdgeEndpoints`
3. `blossomchilds` → `blossomChildren`
4. `blossomparent` → `blossomParent`
5. `blossombase` → `blossomBase`
6. `unusedblossoms` → `freeBlossom`
7. `inblossom` → `vertexTopBlossom`
8. `allowedge` → `edgeTight`
9. `neighbend` → `neighborEdges`
10. `endpoint` → `endpoints` (careful: only the array declaration and usages,
    not the `endptrick` variable)
11. `labelend` → `labelEndpoints`
12. `bestedge` → `bestEdge`
13. `dualvar` → `dual`
14. `nedge` → `edgeCount`
15. `nvertex` → `vertexCount`
16. `maxweight` → `maxEdgeWeight`
17. `mate` → `match`
18. `label` → `labels` (the array — not uses like `label[b]` inside
    `assignLabel` params which are parameter names)

Note: `label` is also a parameter name in `assignLabel`. Rename the _array_
only, not the parameter. The parameter `t` in `assignLabel` will be renamed in
the next task.

- [ ] **Step 1: Apply all renames**

Apply the 18 renames above using replaceAll. Verify no partial renames leaked
into string literals or comments.

- [ ] **Step 2: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 3: Run lint**

Run: `pnpm run lint:types` Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/blossom.ts
git commit -m "refactor(blossom): rename data structure arrays to descriptive names"
```

---

## Task 4: Rename function parameters and local variables

**Files:**

- Modify: `src/blossom.ts` (function by function)

Rename local variables and parameters per the naming table. Do this
function-by-function to keep diffs reviewable. Within each function, rename all
locals in one pass.

### Functions to process (in order):

1. `slack()` — `k`→`edgeIdx`, `index,index_`→`u,v`, `wt`→`weight`
2. `blossomLeaves()` — `b`→`node`, `t`→`child`
3. `assignLabel()` — `w`→`vertex`, `t`→`labelType`, `p`→`endpointIdx`,
   `b`→`blossom`
4. `scanBlossom()` — `v,w`→`vertexA,vertexB`, `vv,ww`→`cursorA,cursorB`,
   `b`→`blossom`, `temporary`→`swap`
5. `addBlossom()` — all per naming table
6. `expandBlossom()` — all per naming table
7. `augmentBlossom()` — all per naming table
8. `augmentMatching()` — all per naming table
9. Main loop body — `_t`→`stage`, inner `v`→`vertex`, `p`→`neighborEndpoint`,
   `k`→`edgeIdx`, `w`→`neighbor`, `kslack`→`edgeSlack`, `bb`→`blossomIdx`, delta
   vars, etc.

- [ ] **Step 1: Rename locals in helper functions (slack through
      augmentMatching)**

Apply renames per the naming table to each function. The parameter names of
`assignLabel` should change to `(vertex, labelType, endpointIdx)`.

- [ ] **Step 2: Rename locals in the main loop**

Rename all loop variables in the outer `for` loop and inner `while` loops per
the naming table.

- [ ] **Step 3: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 4: Run lint**

Run: `pnpm run lint:types` Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/blossom.ts
git commit -m "refactor(blossom): rename function parameters and local variables"
```

---

## Task 5: Add inline comments to initialization block

**Files:**

- Modify: `src/blossom.ts` (initialization section inside `maxWeightMatching`)

Add comments to every array declaration explaining what it stores and how it's
indexed. No code changes.

- [ ] **Step 1: Add comments to each array declaration**

Add a comment above or on the same line as each declaration. Examples:

```typescript
// ── Graph representation ──

// Flat endpoint array: edge k has vertex endpoints[2k] and endpoints[2k+1].
// The XOR trick (p ^ 1) gives the other endpoint of the same edge.
const endpoints: number[] = Array.from({ length: 2 * edgeCount });

// Per-vertex list of endpoint indices for incident edges.
// neighborEdges[v] contains endpoint indices pointing TO v's neighbors
// (i.e. for edge k between u and v, neighborEdges[u] gets 2k+1 and
// neighborEdges[v] gets 2k — each pointing at the OTHER vertex).
const neighborEdges: number[][] = Array.from({ length: vertexCount }, () => []);

// ── Matching state ──

// match[v] = endpoint index of v's matched partner, or -1 if unmatched.
// If match[v] = p, then v is matched to endpoints[p].
const match: number[] = Array.from({ length: vertexCount }, () => -1);

// ── Labelling (alternating tree) ──

// labels[i] = 0 (free/unlabelled), 1 (S-vertex), or 2 (T-vertex).
// Indexed by both vertex IDs (0..vertexCount-1) and blossom IDs
// (vertexCount..2*vertexCount-1).
const labels: number[] = Array.from({ length: 2 * vertexCount }, () => 0);

// labelEndpoints[i] = the endpoint index through which node i was
// reached during tree-growing. -1 for root S-vertices (unmatched).
const labelEndpoints: number[] = Array.from(
  { length: 2 * vertexCount },
  () => -1,
);

// ── Blossom structure ──

// vertexTopBlossom[v] = the outermost blossom containing vertex v.
// Initially, each vertex is its own trivial blossom (vertexTopBlossom[v] = v).
const vertexTopBlossom: number[] = Array.from(
  { length: vertexCount },
  (_, i) => i,
);

// blossomParent[b] = the parent blossom of b in the blossom tree, or -1
// if b is a top-level blossom.
const blossomParent: number[] = Array.from(
  { length: 2 * vertexCount },
  () => -1,
);

// blossomChildren[b] = ordered list of sub-blossoms forming the odd cycle.
// undefined for trivial blossoms (single vertices).
const blossomChildren: (number[] | undefined)[] = Array.from({
  length: 2 * vertexCount,
});

// blossomBase[b] = the base vertex of blossom b. For a trivial blossom
// (vertex v), blossomBase[v] = v. For a non-trivial blossom, it's the
// vertex at position 0 in the child cycle — the vertex through which
// the blossom connects to the rest of the alternating tree.
const blossomBase: number[] = [
  ...Array.from({ length: vertexCount }, (_, i) => i),
  ...Array.from({ length: vertexCount }, () => -1),
];

// blossomEdgeEndpoints[b] = endpoint indices connecting consecutive children
// in the blossom cycle. undefined for trivial blossoms.
const blossomEdgeEndpoints: (number[] | undefined)[] = Array.from({
  length: 2 * vertexCount,
});

// ── Best-edge tracking ──

// bestEdge[i] = the edge index with minimum slack from node i to an
// S-blossom. -1 if no such edge is known. Used to find the next tight
// edge during dual updates.
const bestEdge: number[] = Array.from({ length: 2 * vertexCount }, () => -1);

// blossomBestEdges[b] = list of edge indices — the best edges from each
// of blossom b's children to outside S-blossoms. undefined when not
// applicable (trivial blossoms, or after consumption).
const blossomBestEdges: (number[] | undefined)[] = Array.from({
  length: 2 * vertexCount,
});

// ── Blossom ID pool ──

// Stack of available non-trivial blossom IDs (vertexCount..2*vertexCount-1).
// Pop to allocate a new blossom, push to recycle when expanding.
const freeBlossom: number[] = Array.from(
  { length: vertexCount },
  (_, i) => vertexCount + i,
);

// ── Dual variables ──

// dual[v] for v < vertexCount: vertex dual variable, initialised to
// maxEdgeWeight. The algorithm subtracts from S-vertex duals and adds to
// T-vertex duals during each stage.
//
// dual[b] for b >= vertexCount: blossom dual variable, initialised to 0.
// Accumulates during contraction; must be non-negative (expanded when zero).
const dual: DynamicUint[] = Array.from({ length: 2 * vertexCount }, (_, i) =>
  i < vertexCount ? dualFrom(maxEdgeWeight) : dualZero(),
);

// ── Per-stage state ──

// edgeTight[k] = true if edge k has zero slack (is "tight") and can
// participate in the matching. Reset each stage.
const edgeTight: boolean[] = Array.from({ length: edgeCount }, () => false);

// Queue of S-labelled vertices whose neighbors have not yet been scanned.
let queue: number[] = [];
```

- [ ] **Step 2: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 3: Commit**

```bash
git add src/blossom.ts
git commit -m "docs(blossom): annotate all data structure declarations"
```

---

## Task 6: Add inline comments to helper functions

**Files:**

- Modify: `src/blossom.ts` (four helper functions)

Add JSDoc and inline comments to `slack()`, `blossomLeaves()`, `assignLabel()`,
and `scanBlossom()`. No code changes.

- [ ] **Step 1: Document slack()**

```typescript
/**
 * Compute the slack of edge `edgeIdx`: dual[u] + dual[v] - 2*weight.
 * An edge is "tight" (eligible for matching) when its slack is zero.
 * Negative slack should not occur in a correct run.
 */
```

- [ ] **Step 2: Document blossomLeaves()**

```typescript
/**
 * Yield all vertices (leaf nodes) contained in blossom `node`.
 * If `node` is a vertex (< vertexCount), yields just that vertex.
 * Otherwise, recursively descends through the blossom's children.
 */
```

- [ ] **Step 3: Document assignLabel()**

```typescript
/**
 * Assign label `labelType` (1=S or 2=T) to vertex `vertex` and its
 * top-level blossom, recording the endpoint that reached it.
 *
 * - S-label (1): All vertices in the blossom are added to the scan queue.
 * - T-label (2): The base vertex's mate is recursively labelled S,
 *   extending the alternating tree by one matched edge.
 */
```

- [ ] **Step 4: Document scanBlossom()**

```typescript
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
```

- [ ] **Step 5: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 6: Commit**

```bash
git add src/blossom.ts
git commit -m "docs(blossom): document helper functions (slack, leaves, label, scan)"
```

---

## Task 7: Add inline comments to blossom operations

**Files:**

- Modify: `src/blossom.ts` (three blossom functions)

Add JSDoc and inline comments to `addBlossom()`, `expandBlossom()`, and
`augmentBlossom()`. These are the most complex functions. No code changes.

- [ ] **Step 1: Document addBlossom()**

```typescript
/**
 * Create a new blossom from the odd cycle discovered by edge `edgeIdx`
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
```

Add inline comments inside the function for:

- The two `while` loops that trace paths from `vertexU` and `vertexW` back to
  `baseBlossom`
- The `path.reverse()` / `endps.reverse()` that orients the cycle
- The best-edge merging logic

- [ ] **Step 2: Document expandBlossom()**

```typescript
/**
 * Expand (dissolve) blossom `blossom`, restoring its children as
 * independent nodes.
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
 * 2. Walk the cycle in the direction that pairs children as T-S pairs
 *    (even-length sub-paths in the cycle).
 * 3. Assign T/S labels to paired children.
 * 4. Any remaining children that were already S-labelled keep their
 *    labels.
 *
 * The `endptrick` parity variable handles the direction-dependent
 * flipping of endpoint indices (since the cycle can be traversed in
 * either direction, and the endpoint encoding is directional).
 */
```

- [ ] **Step 3: Document augmentBlossom()**

```typescript
/**
 * Update the matching inside blossom `blossom` to reflect that vertex
 * `vertex` is now matched to an external vertex.
 *
 * The blossom's internal matching must be rotated so that `vertex`'s
 * sub-blossom becomes the new base (position 0 in the children array).
 * This involves walking the cycle from `vertex`'s position back to
 * position 0, flipping matched/unmatched edges along the way.
 *
 * If any child along the path is itself a non-trivial blossom,
 * recursively augment it too.
 *
 * The `jstep` and `endptrick` variables handle the two possible
 * traversal directions around the odd cycle (we always choose the
 * direction that gives an even-length path from `vertex` to the base).
 */
```

- [ ] **Step 4: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 5: Commit**

```bash
git add src/blossom.ts
git commit -m "docs(blossom): document blossom operations (add, expand, augment)"
```

---

## Task 8: Extract neighbor scanning into a named function

**Files:**

- Modify: `src/blossom.ts` (main loop)

Extract the inner `while (queue.length > 0 && !augmented)` block into a function
called `scanNeighbors`. This is the "grow the alternating tree" phase.

- [ ] **Step 1: Define the function**

Create a new function inside `maxWeightMatching`, placed after `augmentMatching`
and before the main `for` loop:

```typescript
/**
 * Process the queue of S-labelled vertices, scanning their neighbors
 * to grow alternating trees.
 *
 * For each tight edge from an S-vertex to a neighbor:
 * - Free neighbor → label it T (and its mate becomes S).
 * - S-neighbor in same tree → odd cycle found → contract into blossom.
 * - S-neighbor in different tree → augmenting path → augment matching.
 *
 * For non-tight edges, track the best (minimum slack) edge to each
 * S-blossom or free vertex for later dual updates.
 *
 * @returns true if an augmenting path was found (matching was augmented).
 */
function scanNeighbors(): boolean {
  while (queue.length > 0) {
    // ... move the existing queue processing loop body here ...
  }
  return false;
}
```

Move the entire body of the `while (queue.length > 0 && !augmented)` loop into
this function. The function returns `true` when augmentation happens (replacing
the `augmented` flag for this section). Add inline comments for each branch.

- [ ] **Step 2: Update the call site**

Replace the inner while loop in the main loop with:

```typescript
const augmented = scanNeighbors();
if (augmented) break;
```

Remove the old `let augmented = false;` declaration (it's now the return value
of `scanNeighbors()`). Keep the outer `if (!augmented) break;` at the end of the
stage loop — it still reads from the same `augmented` const.

Note: since the existing code declares `let augmented = false` before the
`while(true)` and checks it at the end, restructure so that `augmented` is set
from the return value of `scanNeighbors()` inside the `while(true)` loop.

- [ ] **Step 3: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 4: Run lint**

Run: `pnpm run lint:types` Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/blossom.ts
git commit -m "refactor(blossom): extract scanNeighbors from main loop"
```

---

## Task 9: Extract delta computation into a named function

**Files:**

- Modify: `src/blossom.ts` (main loop)

Extract the delta type selection logic into a function called `computeDelta`.

- [ ] **Step 1: Define the function**

```typescript
/**
 * Compute the minimum dual variable adjustment (delta) that will make
 * progress possible. Returns the delta type, value, and associated
 * edge or blossom.
 *
 * Delta types:
 * - Type 1: Minimum vertex dual among all vertices. When this reaches
 *   zero, no further augmentations are possible (optimality reached).
 * - Type 2: Slack of the best edge from a free vertex to an S-blossom.
 *   Making this edge tight lets the free vertex join an alternating tree.
 * - Type 3: Half the slack of the best edge between two S-blossoms.
 *   Making this edge tight either creates a new blossom or finds an
 *   augmenting path.
 * - Type 4: Dual variable of a T-blossom. When this reaches zero, the
 *   blossom can be expanded.
 *
 * @returns Object with deltaType (-1 if none), delta value, deltaEdge,
 *   and deltaBlossom.
 */
function computeDelta(): {
  delta: DynamicUint;
  deltaBlossom: number;
  deltaEdge: number;
  deltaType: number;
} {
  // ... move existing delta computation here ...
}
```

Move the four delta-scanning loops and the maxcardinality fallback into this
function.

- [ ] **Step 2: Update the call site**

Replace the inline delta computation with:

```typescript
const { deltaType, delta, deltaEdge, deltaBlossom } = computeDelta();
```

- [ ] **Step 3: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 4: Commit**

```bash
git add src/blossom.ts
git commit -m "refactor(blossom): extract computeDelta from main loop"
```

---

## Task 10: Extract dual variable update into a named function

**Files:**

- Modify: `src/blossom.ts` (main loop)

Extract the dual update loops into `applyDualUpdate`.

- [ ] **Step 1: Define the function**

```typescript
/**
 * Apply the dual variable adjustment `delta` to maintain complementary
 * slackness:
 *
 * - S-vertices (label=1): subtract delta (they "pay" for tight edges).
 * - T-vertices (label=2): add delta (they "receive" compensation).
 * - S-blossoms (label=1): add delta to blossom dual.
 * - T-blossoms (label=2): subtract delta from blossom dual.
 *
 * The opposite signs for blossoms vs. vertices maintain the invariant
 * that contracting a blossom doesn't change any edge's slack.
 */
function applyDualUpdate(delta: DynamicUint): void {
  for (let v = 0; v < vertexCount; v++) {
    if (labels[vertexTopBlossom[v]!] === 1) dual[v]!.subtract(delta);
    else if (labels[vertexTopBlossom[v]!] === 2) dual[v]!.add(delta);
  }
  for (let b = vertexCount; b < 2 * vertexCount; b++) {
    if (blossomBase[b]! >= 0 && blossomParent[b] === -1) {
      if (labels[b] === 1) dual[b]!.add(delta);
      else if (labels[b] === 2) dual[b]!.subtract(delta);
    }
  }
}
```

- [ ] **Step 2: Replace inline code with function call**

Replace the two dual-update `for` loops in the main loop with:

```typescript
applyDualUpdate(delta);
```

- [ ] **Step 3: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 4: Commit**

```bash
git add src/blossom.ts
git commit -m "refactor(blossom): extract applyDualUpdate from main loop"
```

---

## Task 11: Extract delta handling into a named function

**Files:**

- Modify: `src/blossom.ts` (main loop)

Extract the `switch(deltaType)` block into `handleDelta`.

- [ ] **Step 1: Define the function**

```typescript
/**
 * Act on the chosen delta type to make progress:
 *
 * - Type 2: An edge from a free vertex to an S-blossom became tight.
 *   Add the free vertex to the scan queue.
 * - Type 3: An edge between two S-blossoms became tight. Add one
 *   endpoint to the queue (it will be processed in the next scan).
 * - Type 4: A T-blossom's dual reached zero. Expand it, exposing its
 *   children for potential augmenting paths.
 * - Type 1: No progress possible. (Handled by caller as termination.)
 */
function handleDelta(
  deltaType: number,
  deltaEdge: number,
  deltaBlossom: number,
): void {
  switch (deltaType) {
    case 2: {
      edgeTight[deltaEdge] = true;
      const [endpointA, endpointB] = edges[deltaEdge]!;
      const vertex =
        labels[vertexTopBlossom[endpointA]!] === 0 ? endpointB : endpointA;
      queue.push(vertex);
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
  }
}
```

- [ ] **Step 2: Replace the switch block in the main loop**

```typescript
handleDelta(deltaType, deltaEdge, deltaBlossom);
if (deltaType === 1) break;
```

- [ ] **Step 3: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 4: Commit**

```bash
git add src/blossom.ts
git commit -m "refactor(blossom): extract handleDelta from main loop"
```

---

## Task 12: Add comments to outer stage loop and result construction

**Files:**

- Modify: `src/blossom.ts` (main loop and result section)

Add section comments to the remaining undocumented parts: the outer `for` loop,
the `augmentMatching` function, the end-of-stage blossom expansion, and the
final result construction.

- [ ] **Step 1: Document augmentMatching()**

```typescript
/**
 * Augment the matching along the augmenting path that passes through
 * edge `edgeIdx`.
 *
 * Starting from each endpoint of the edge, trace back through the
 * alternating tree to the root (unmatched vertex), flipping
 * matched/unmatched edges along the way. If a vertex is inside a
 * non-trivial blossom, recursively augment that blossom's internal
 * matching too.
 *
 * After this function, the matching size has increased by one.
 */
```

- [ ] **Step 2: Add section comments to the main loop**

```typescript
  // ══════════════════════════════════════════════════════════════════════
  // Main loop: at most vertexCount stages, each finding one augmenting
  // path and increasing the matching size by one.
  // ══════════════════════════════════════════════════════════════════════
  for (let stage = 0; stage < vertexCount; stage++) {
    // ── Stage initialization ──
    // Reset all labels, best-edge tracking, and tightness flags.
    // Label all unmatched vertices as S (label=1) to seed alternating trees.
    ...

    // ── Inner loop: alternate between scanning and dual updates ──
    while (true) {
      const augmented = scanNeighbors();
      if (augmented) break;

      // No augmenting path found yet — adjust dual variables to make
      // new edges tight and retry.
      const { deltaType, delta, deltaEdge, deltaBlossom } = computeDelta();
      applyDualUpdate(delta);
      handleDelta(deltaType, deltaEdge, deltaBlossom);
      if (deltaType === 1) break;
    }

    if (!augmented) break; // No augmentation possible → optimal matching found.

    // ── End-of-stage cleanup ──
    // Expand any top-level S-blossoms whose dual variable has reached zero.
    // These blossoms are no longer needed and their vertices should be
    // independent for the next stage.
    ...
  }

  // ── Build result array ──
  // Convert the internal endpoint-based matching representation to a
  // simple vertex→vertex mapping. result[v] = the vertex matched to v,
  // or -1 if v is unmatched.
```

- [ ] **Step 3: Run tests**

Run: `pnpm run test src/__tests__/blossom.spec.ts` Expected: 20 passed

- [ ] **Step 4: Commit**

```bash
git add src/blossom.ts
git commit -m "docs(blossom): document main loop, augmentMatching, and result construction"
```

---

## Task 13: Final review pass

**Files:**

- Modify: `src/blossom.ts`

Read the entire file top-to-bottom. Fix any inconsistencies in comment style,
variable naming, or section structure.

- [ ] **Step 1: Review and fix**

Check for:

- Comments that reference old variable names
- Inconsistent comment style (e.g., mixing `//` and `/** */` where one is
  expected)
- Any remaining single-letter variable names that should have been renamed
- Section header style consistency (`// ──` vs `// ==`)
- Orphaned comments that no longer apply after extraction

- [ ] **Step 2: Run full test suite**

Run: `pnpm test` Expected: all tests pass (not just blossom — confirm no
regressions in consumers)

- [ ] **Step 3: Run lint**

Run: `pnpm run lint` Expected: no errors, no warnings

- [ ] **Step 4: Commit**

```bash
git add src/blossom.ts
git commit -m "refactor(blossom): final review pass for consistency"
```
