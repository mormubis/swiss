# Incremental Matching Computer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port bbpPairings' `matching::Computer` to TypeScript — a stateful,
incremental maximum-weight matching computer that preserves dual variables and
matching state across `setEdgeWeight` + `computeMatching` calls.

**Architecture:** Direct port of bbpPairings' C++ implementation into a single
TypeScript file (`src/matching-computer.ts`). Uses object references (not flat
arrays) to match the C++ pointer-based design. Each `Vertex`, `RootBlossom`, and
`ParentBlossom` is a class instance. The `Graph` class owns all vertices and
blossom pools. `MatchingComputer` wraps `Graph` with the public API.

**Tech Stack:** TypeScript, `DynamicUint` (existing arbitrary-precision unsigned
integer)

---

## Why this approach

Previous attempts failed because:

1. A wrapper around the stateless blossom doesn't replicate incremental
   dual-variable optimization
2. Reimagining the algorithm with flat arrays lost the pointer semantics that
   make blossom formation/dissolution work

The bbpPairings C++ uses pointer-based linked lists extensively. The most
faithful port uses JS object references the same way — each blossom/vertex is an
object, cross-references are direct object properties. This avoids
index-management bugs that plagued the flat-array approach.

## File structure

```
src/matching-computer.ts    — ~700 lines, single file containing:
  - Label enum
  - Blossom base class
  - Vertex class (extends Blossom)
  - ParentBlossom class (extends Blossom)
  - RootBlossom class
  - Graph class (container + algorithm)
  - MatchingComputer class (public API wrapper)

src/__tests__/matching-computer.spec.ts — tests
```

All types are internal to the module (not exported except `MatchingComputer`).

## Reference source mapping

Each function in the plan maps to a bbpPairings source location:

| TypeScript                                      | bbpPairings source                                               |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `MatchingComputer.constructor`                  | `computer.cpp:Computer()`                                        |
| `MatchingComputer.addVertex`                    | `computer.cpp:addVertex()`                                       |
| `MatchingComputer.setEdgeWeight`                | `computer.cpp:setEdgeWeight()`                                   |
| `MatchingComputer.computeMatching`              | `computer.cpp:computeMatching()` → `graph.cpp:computeMatching()` |
| `MatchingComputer.getMatching`                  | `computer.cpp:getMatching()`                                     |
| `Graph.augmentMatching`                         | `graph.cpp:augmentMatching()`                                    |
| `Graph.initializeLabeling`                      | `graph.cpp:initializeLabeling()`                                 |
| `Graph.initializeInnerOuterEdges`               | `graph.cpp:initializeInnerOuterEdges()`                          |
| `Graph.initializeOuterOuterEdges`               | `graph.cpp:initializeOuterOuterEdges()`                          |
| `Graph.updateInnerOuterEdges`                   | `graph.cpp:updateInnerOuterEdges()`                              |
| `augmentToSource`                               | `rootblossom.cpp:augmentToSource()`                              |
| `RootBlossom.prepareVertexForWeightAdjustments` | `rootblossomimpl.h:prepareVertexForWeightAdjustments()`          |
| `RootBlossom.freeAncestorOfBase`                | `rootblossom.cpp:freeAncestorOfBase()`                           |
| `RootBlossom.putVerticesInMatchingOrder`        | `rootblossom.cpp:putVerticesInMatchingOrder()`                   |
| `ParentBlossom.connectChildren`                 | `parentblossom.cpp:connectChildren()`                            |

---

### Task 1: Data structures — Blossom, Vertex, ParentBlossom, RootBlossom

**Files:**

- Create: `src/matching-computer.ts`
- Test: `src/__tests__/matching-computer.spec.ts`

Port the four core data structures. Each is a class with the same fields as the
C++ version but using object references instead of pointers. `null` replaces C++
`nullptr`.

Key fields per class:

**Blossom** (abstract base):

- `rootBlossom: RootBlossom`
- `parentBlossom: ParentBlossom | null`
- `vertexListHead: Vertex`, `vertexListTail: Vertex`
- `vertexToPrevSibling: Vertex | null`, `vertexToNextSibling: Vertex | null`
- `nextBlossom: Blossom | null`, `prevBlossom: Blossom | null`
- `isVertex: boolean`

**Vertex** (extends Blossom):

- `edgeWeights: DynamicUint[]` — indexed by vertexIndex
- `dualVariable: DynamicUint` — reference into graph.vertexDualVariables
- `minOuterEdgeResistance: DynamicUint`
- `minOuterEdge: Vertex | null`
- `nextVertex: Vertex | null` — linked list within root blossom
- `vertexIndex: number`
- `resistance(other: Vertex): DynamicUint` —
  `dual[this] + dual[other] - edgeWeight[this][other]`

**ParentBlossom** (extends Blossom):

- `dualVariable: DynamicUint`
- `subblossom: Blossom | null`
- `iterationStartsWithSubblossom: boolean`
- `connectChildren(path: Vertex[])` — initializes circular sibling list

**RootBlossom**:

- `rootChild: Blossom`
- `baseVertex: Vertex`
- `baseVertexMatch: Vertex | null`
- `label: Label`
- `labelingVertex: Vertex | null`, `labeledVertex: Vertex | null`
- `minOuterEdges: (Vertex | null)[]` — indexed by vertexIndex
- `minOuterEdgeResistance: DynamicUint`
- `prepareVertexForWeightAdjustments(vertex, graph)`
- `freeAncestorOfBase(ancestor, graph)`
- `putVerticesInMatchingOrder()`

- [ ] **Step 1: Write tests for basic data structure creation**

```typescript
import { describe, expect, it } from 'vitest';
import { MatchingComputer } from '../matching-computer.js';
import { DynamicUint } from '../dynamic-uint.js';

describe('MatchingComputer', () => {
  it('starts with zero vertices', () => {
    const mc = new MatchingComputer(10, DynamicUint.from(100));
    expect(mc.size()).toBe(0);
  });

  it('addVertex increases size', () => {
    const mc = new MatchingComputer(4, DynamicUint.from(100));
    mc.addVertex();
    mc.addVertex();
    expect(mc.size()).toBe(2);
  });

  it('unmatched vertices match to themselves', () => {
    const mc = new MatchingComputer(3, DynamicUint.from(100));
    mc.addVertex();
    mc.addVertex();
    mc.addVertex();
    mc.computeMatching();
    expect(mc.getMatching()).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/matching-computer.spec.ts`

- [ ] **Step 3: Implement data structures + MatchingComputer shell**

Create `src/matching-computer.ts` with all four classes and the
`MatchingComputer` wrapper. The `computeMatching` calls
`graph.computeMatching()` which calls `while (augmentMatching()) {}` — but
`augmentMatching` returns `false` (stub). `getMatching` walks root blossoms.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/matching-computer.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/matching-computer.ts src/__tests__/matching-computer.spec.ts
git commit -m "feat(matching): data structures for incremental matching computer"
```

---

### Task 2: Graph algorithm — augmentMatching core loop

**Files:**

- Modify: `src/matching-computer.ts`
- Modify: `src/__tests__/matching-computer.spec.ts`

Port the `augmentMatching` method from `graph.cpp`. This is the main
dual-variable adjustment loop. It calls:

- `initializeLabeling()` — set labels based on matching state
- `initializeInnerOuterEdges()` — compute min resistance from non-OUTER to OUTER
- `initializeOuterOuterEdges()` — compute min resistance between OUTER pairs
- Then the while loop: compute dual adjustment → apply → check condition

The loop handles 5 conditions:

1. `minOuterDualVariable = 0` → augment via `augmentToSource`
2. `minInnerOuterResist = 0 && ZERO` → augment ZERO-to-OUTER
3. `minOuterOuterResist = 0` → form blossom or augment
4. `minInnerOuterResist = 0 && FREE` → label FREE→INNER, match→OUTER
5. `minInnerDualVariable = 0` → dissolve inner blossom

For this task, implement conditions 1, 2, and 4 (augmentation and labeling).
Conditions 3 and 5 (blossom formation and dissolution) are Task 3.

Also implement `augmentToSource` — the simple while loop from `rootblossom.cpp`:

```typescript
function augmentToSource(vertex: Vertex, newMatch: Vertex | null): void {
  while (vertex.rootBlossom.baseVertexMatch) {
    vertex.rootBlossom.baseVertex = vertex;
    const originalMatch = vertex.rootBlossom.baseVertexMatch.rootBlossom;
    vertex.rootBlossom.baseVertexMatch = newMatch;
    originalMatch.baseVertex = originalMatch.labeledVertex!;
    originalMatch.baseVertexMatch = originalMatch.labelingVertex!;
    vertex = originalMatch.labelingVertex!;
    newMatch = originalMatch.labeledVertex!;
  }
  vertex.rootBlossom.baseVertex = vertex;
  vertex.rootBlossom.baseVertexMatch = newMatch;
}
```

- [ ] **Step 1: Write tests for simple matching (no blossoms needed)**

```typescript
it('matches a simple 2-vertex graph', () => {
  const mc = new MatchingComputer(2, DynamicUint.from(100));
  mc.addVertex();
  mc.addVertex();
  mc.setEdgeWeight(0, 1, DynamicUint.from(10));
  mc.computeMatching();
  expect(mc.getMatching()).toEqual([1, 0]);
});

it('matches two independent pairs', () => {
  const mc = new MatchingComputer(4, DynamicUint.from(100));
  for (let i = 0; i < 4; i++) mc.addVertex();
  mc.setEdgeWeight(0, 1, DynamicUint.from(10));
  mc.setEdgeWeight(2, 3, DynamicUint.from(10));
  mc.computeMatching();
  expect(mc.getMatching()).toEqual([1, 0, 3, 2]);
});

it('matches a 4-vertex path maximizing cardinality', () => {
  const mc = new MatchingComputer(4, DynamicUint.from(100));
  for (let i = 0; i < 4; i++) mc.addVertex();
  mc.setEdgeWeight(0, 1, DynamicUint.from(10));
  mc.setEdgeWeight(1, 2, DynamicUint.from(20));
  mc.setEdgeWeight(2, 3, DynamicUint.from(10));
  mc.computeMatching();
  const m = mc.getMatching();
  // Max cardinality: 0-1 + 2-3 (total 20, same as 1-2 alone but 2 pairs vs 1)
  expect(m[0]).toBe(1);
  expect(m[1]).toBe(0);
  expect(m[2]).toBe(3);
  expect(m[3]).toBe(2);
});

it('supports incremental updates', () => {
  const mc = new MatchingComputer(4, DynamicUint.from(100));
  for (let i = 0; i < 4; i++) mc.addVertex();
  mc.setEdgeWeight(0, 1, DynamicUint.from(10));
  mc.setEdgeWeight(2, 3, DynamicUint.from(10));
  mc.computeMatching();
  expect(mc.getMatching()).toEqual([1, 0, 3, 2]);

  mc.setEdgeWeight(1, 2, DynamicUint.from(50));
  mc.computeMatching();
  const m = mc.getMatching();
  expect(m[1]).toBe(2);
  expect(m[2]).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement augmentMatching (conditions 1, 2, 4) +
      augmentToSource + helper functions**

Port directly from `graph.cpp:augmentMatching()`. For condition 3 (blossom
formation), stub it to `continue` (skip). For condition 5 (blossom dissolution),
stub it to `continue`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/matching-computer.ts src/__tests__/matching-computer.spec.ts
git commit -m "feat(matching): augmentMatching core loop with dual adjustment"
```

---

### Task 3: Blossom formation and dissolution

**Files:**

- Modify: `src/matching-computer.ts`
- Modify: `src/__tests__/matching-computer.spec.ts`

Port the remaining two conditions from `augmentMatching`:

- **Condition 3** (`minOuterOuterResist = 0`): build alternating path from both
  vertices back to their root, check if same root blossom. If same → form new
  blossom (odd cycle contraction via `ParentBlossom`). If different → augment.
- **Condition 5** (`minInnerDualVariable = 0`): dissolve an INNER blossom back
  into its sub-blossoms, creating new root blossoms for each child.

Also port `freeAncestorOfBase` from `rootblossom.cpp` — needed by
`prepareVertexForWeightAdjustments`.

- [ ] **Step 1: Write tests that require blossom handling**

```typescript
it('matches a triangle correctly (requires blossom)', () => {
  const mc = new MatchingComputer(3, DynamicUint.from(100));
  for (let i = 0; i < 3; i++) mc.addVertex();
  mc.setEdgeWeight(0, 1, DynamicUint.from(10));
  mc.setEdgeWeight(1, 2, DynamicUint.from(20));
  mc.setEdgeWeight(0, 2, DynamicUint.from(15));
  mc.computeMatching();
  const m = mc.getMatching();
  expect(m[1]).toBe(2);
  expect(m[2]).toBe(1);
  expect(m[0]).toBe(0); // unmatched
});

it('handles a 5-vertex graph with blossom', () => {
  // K5-like subgraph that forces blossom contraction
  const mc = new MatchingComputer(5, DynamicUint.from(100));
  for (let i = 0; i < 5; i++) mc.addVertex();
  mc.setEdgeWeight(0, 1, DynamicUint.from(10));
  mc.setEdgeWeight(1, 2, DynamicUint.from(10));
  mc.setEdgeWeight(2, 0, DynamicUint.from(10)); // triangle
  mc.setEdgeWeight(0, 3, DynamicUint.from(5));
  mc.setEdgeWeight(2, 4, DynamicUint.from(5));
  mc.computeMatching();
  const m = mc.getMatching();
  // Should find 2 pairs (max cardinality): e.g. 0-3, 1-2, 4 unmatched
  // or 0-1, 2-4, 3 unmatched
  let paired = 0;
  for (let i = 0; i < 5; i++) if (m[i] !== i) paired++;
  expect(paired).toBe(4); // 2 pairs = 4 matched vertices
});

it('handles blossom dissolution during incremental update', () => {
  const mc = new MatchingComputer(6, DynamicUint.from(100));
  for (let i = 0; i < 6; i++) mc.addVertex();
  mc.setEdgeWeight(0, 1, DynamicUint.from(10));
  mc.setEdgeWeight(1, 2, DynamicUint.from(10));
  mc.setEdgeWeight(2, 0, DynamicUint.from(10));
  mc.setEdgeWeight(3, 4, DynamicUint.from(10));
  mc.setEdgeWeight(4, 5, DynamicUint.from(10));
  mc.computeMatching();

  // Now connect the triangle to the path
  mc.setEdgeWeight(2, 3, DynamicUint.from(20));
  mc.computeMatching();
  const m = mc.getMatching();
  // Should match 2-3 (weight 20) and find other pairs
  expect(m[2]).toBe(3);
  expect(m[3]).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement blossom formation (condition 3)**

Port the path-building logic from `graph.cpp` (lines starting at
`std::deque path`):

1. Build path from both vertices back to root
2. If same root → trim common prefix → form ParentBlossom via `connectChildren`
3. If different roots → augment

- [ ] **Step 4: Implement blossom dissolution (condition 5)**

Port from `graph.cpp` (the `!minInnerDualVariable` block):

1. Hide the root blossom being dissolved
2. Find rootChild and connectChild
3. Walk the circular child list, creating new RootBlossoms with appropriate
   labels
4. Destroy the old ParentBlossom and RootBlossom

- [ ] **Step 5: Implement freeAncestorOfBase**

Port from `rootblossom.cpp`. This is needed when `setEdgeWeight` disrupts a
vertex inside a non-trivial blossom.

- [ ] **Step 6: Run tests to verify they pass**

- [ ] **Step 7: Run the full test suite**

Run: `pnpm lint && pnpm test`

- [ ] **Step 8: Commit**

```bash
git add src/matching-computer.ts src/__tests__/matching-computer.spec.ts
git commit -m "feat(matching): blossom formation and dissolution"
```

---

### Task 4: computeMatching, getMatching, cross-validation

**Files:**

- Modify: `src/matching-computer.ts`
- Modify: `src/__tests__/matching-computer.spec.ts`

Port `computeMatching` (parity fixup) and `getMatching`
(putVerticesInMatchingOrder). Add cross-validation tests against the existing
`maxWeightMatching`.

- [ ] **Step 1: Write cross-validation test**

```typescript
import { maxWeightMatching } from '../blossom.js';

it('produces same total weight as maxWeightMatching on random graphs', () => {
  for (let trial = 0; trial < 50; trial++) {
    const n = 4 + Math.floor(Math.random() * 8);
    const maxW = 100;
    const mc = new MatchingComputer(n, DynamicUint.from(maxW));
    const edges: [number, number, DynamicUint][] = [];
    for (let i = 0; i < n; i++) mc.addVertex();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.random() < 0.5) {
          const w = DynamicUint.from(1 + Math.floor(Math.random() * maxW));
          mc.setEdgeWeight(i, j, w.clone());
          edges.push([i, j, w]);
        }
      }
    }
    mc.computeMatching();
    const mcM = mc.getMatching();
    const blossomM = maxWeightMatching(edges, true);

    let mcWeight = 0n,
      blossomWeight = 0n;
    for (const [u, v, w] of edges) {
      if (mcM[u] === v) mcWeight += w.toBigInt();
      if (blossomM[u] === v) blossomWeight += w.toBigInt();
    }
    expect(mcWeight).toBe(blossomWeight);
  }
});
```

- [ ] **Step 2: Run test to verify it fails (if parity fixup is missing)**

- [ ] **Step 3: Implement parity fixup in computeMatching**

Port from `graph.cpp:computeMatching()` — the loop that ensures exposed vertex
dual variables have even parity.

- [ ] **Step 4: Implement putVerticesInMatchingOrder in getMatching**

Port from `rootblossom.cpp`. This reorders the vertex linked list so matched
vertices are consecutive, which `getMatching` needs to read internal matching
pairs.

- [ ] **Step 5: Run all tests**

Run: `pnpm lint && pnpm test`

- [ ] **Step 6: Commit**

```bash
git add src/matching-computer.ts src/__tests__/matching-computer.spec.ts
git commit -m "feat(matching): computeMatching parity fixup and cross-validation"
```

---

### Task 5: Integrate into dutch.ts

**Files:**

- Modify: `src/dutch.ts`
- Modify: `src/__tests__/dutch.fixtures.spec.ts`

Replace `EdgeWeightMatrix` + `buildCurrentEdges` + `runBlossom` + `finalizePair`
with `MatchingComputer` calls.

- [ ] **Step 1: Change `it.fails` to `it` for the exact pairings test**

- [ ] **Step 2: Run test to verify RED**

- [ ] **Step 3: Replace dutch.ts matching infrastructure**

Key changes:

- Create `MatchingComputer` once with `np` vertices and `maxEdgeWeight`
- Replace `matrix.set(a, b, w)` → `computer.setEdgeWeight(a, b, w)`
- Replace `runBlossom()` →
  `computer.computeMatching(); stableMatching = computer.getMatching()`
- Replace `finalizePair(v1, v2, ...)` →
  `computer.setEdgeWeight(v1, v2, maxEdgeWeight)` + zero all other edges for v1
  and v2
- Remove `EdgeWeightMatrix`, `buildCurrentEdges`, `runBlossom`, `finalizePair`

- [ ] **Step 4: Run all tests to verify GREEN**

- [ ] **Step 5: Run full verification**

Run: `pnpm lint && pnpm test && pnpm build`

- [ ] **Step 6: Commit**

```bash
git add src/dutch.ts src/__tests__/dutch.fixtures.spec.ts
git commit -m "feat(dutch): integrate incremental matching computer for FIDE compliance"
```

---

### Task 6: Cleanup and performance

**Files:**

- Modify: `src/matching-computer.ts` (if optimization needed)
- Modify: `src/dutch.ts` (remove dead code)

- [ ] **Step 1: Check test timing**

Run: `pnpm test -- --reporter=verbose`

Verify `issue_15` (180 players) completes in < 30 seconds.

- [ ] **Step 2: Remove dead code**

Remove `EdgeWeightMatrix` if unused. Remove old `baseEdgeWeights` array if the
matching computer handles it.

- [ ] **Step 3: Full verification**

Run: `pnpm lint && pnpm test && pnpm build`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(dutch): remove unused EdgeWeightMatrix and stateless blossom wrappers"
```
