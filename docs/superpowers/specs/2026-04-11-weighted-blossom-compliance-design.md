# Weighted Blossom Matching for Full FIDE Compliance — Design

**Date:** 2026-04-11 **Depends on:** FIDE Dutch rewrite (completed) **Status:**
Draft — ready for implementation planning

---

## Problem

The current Dutch implementation uses FIDE-exact transposition/exchange
enumeration for brackets of ≤10 players, with a greedy matching fallback for
larger brackets. This produces correct pairings for small brackets but diverges
from the FIDE reference implementation (bbpPairings) for larger ones.

**Evidence:** The `issue_7` fixture (60 players, round 15) has a score group of
11 players at 6.0 points. This bracket exceeds `FIDE_EXACT_LIMIT=10`, triggers
the greedy fallback, and produces different pairings from the bbpPairings
expected output. Only 5 of 30 pairings match.

Raising the limit is not viable: real-world large tournaments (500-1000 players)
can have brackets of 50+ players in middle rounds. C(50, 25) is astronomically
large — transposition enumeration is infeasible.

## Solution

Replace the per-bracket matching with a weighted maximum matching algorithm
(Edmonds' blossom), encoding FIDE criteria C1-C21 as edge weights. This is the
same approach used by bbpPairings, the FIDE-endorsed reference implementation.

### Why this works

The FIDE C.04.3 specification (Articles 3-4) defines a procedural algorithm with
transpositions and exchanges. But FIDE endorsement (VCL.07) only requires that
"all pairings produced by the software must strictly adhere to the rules of the
pairing system" — correctness of output, not algorithmic conformance.

bbpPairings explicitly states: "BBP Pairings always performs pairings using a
weighted matching algorithm, so it does not use the -w and -q options of
JaVaFo." Its time complexity is O(n³ × s² × log n) where s is the number of
score groups.

### Key references

- bbpPairings README: "The core of the pairing engine is an application of the
  simpler of the two weighted matching algorithms exposited in 'An O(EV log V)
  Algorithm for Finding a Maximal Weighted Matching in General Graphs,' by Zvi
  Galil, Silvio Micali, and Harold Gabow, 1986."
- FIDE verification checklist (spp.fide.com): VCL.07 checks output correctness,
  not algorithm.

## Design

### 1. Weighted blossom algorithm

Implement Edmonds' blossom algorithm for maximum weight matching on general
graphs. The algorithm:

1. Builds a graph where each player is a vertex
2. Each valid pairing (edge) gets a weight encoding FIDE criteria priority
3. Finds the maximum weight matching — the set of pairings maximizing total
   weight
4. The weight scheme ensures the optimal matching corresponds to the
   FIDE-correct pairing

**Complexity:** O(n³) per bracket, O(n³ × s²) per round where s = score groups.

### 2. Weight encoding

FIDE criteria C1-C21 have strict priority ordering — C1 violations are
infinitely worse than C6 violations, which are infinitely worse than C12
violations. This maps to exponential weight scaling:

```
edge_weight = Σ (criterion_bonus_i × BASE^(21-i))
```

Where `BASE` is large enough that no combination of lower-priority bonuses can
outweigh a single higher-priority bonus. For practical purposes, BASE=1000 or
even BASE=100 works if the maximum count per criterion is bounded.

**Absolute criteria (edges removed entirely):**

- C1: rematch → no edge
- C3: non-topscorer absolute color conflict → no edge (unless relaxed)

**Edge weight components (higher = better pairing):**

- C5: bonus for pairing that avoids high-score bye (integrated with bye
  selection)
- C6: bonus for being in the matching at all (maximize pairs)
- C7: bonus inversely proportional to downfloater score
- C10-C13: color balance bonuses
- C14-C21: float history bonuses

The exact weight formula needs careful calibration against bbpPairings expected
outputs. The three test fixtures (C5, C9, issue_7) provide regression targets.

### 3. Bracket-level vs global matching

bbpPairings appears to run matching per bracket (score group), not globally. The
bracket-by-bracket structure should be preserved:

1. Process brackets top-down (highest score first)
2. Within each bracket: build weighted graph, run blossom
3. Unmatched players downfloat to next bracket
4. C5/C9 bye optimization: try different bye candidates as currently done

### 4. What to keep from current implementation

- `buildRankedPlayers`, `derivePreference`, `sortByRank` — preprocessing
- `allocateColor` — Article 5 color allocation (applied after matching)
- `evaluateCandidate` — can be repurposed for bye candidate comparison
- `isValidPair` — C1/C3 checks (used to build valid edges)
- C5 bye candidate rotation in `pair()`
- All test infrastructure and fixtures

### 5. What to replace

- `transpositions()` generator — no longer needed for matching
- `generateExchanges()` — no longer needed
- `tryTranspositions()` — replaced by blossom
- `pairHomogeneous` / `pairHeterogeneous` — replaced by single `matchBracket()`
  using blossom
- `maxMatchingPair()` — replaced by proper blossom
- `FIDE_EXACT_LIMIT` — removed entirely

### 6. What to add

- `blossom(n, edges): number[]` — Edmonds' weighted blossom algorithm
  implementation, or a well-tested port from an existing implementation
- `buildWeightedGraph(bracket, games, playerMap)` — constructs edge list with
  FIDE-encoded weights
- `matchBracket(bracket, games, playerMap, totalRounds, bracketIsLast)` — runs
  blossom on the bracket, returns `Candidate`

## Files changed

| File                                   | Change                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| `src/dutch.ts`                         | Replace matching internals, keep preprocessing and color |
| `src/blossom.ts`                       | New — proper Edmonds' blossom algorithm                  |
| `src/__tests__/dutch.fixtures.spec.ts` | Convert issue_7 `.todo` to assertion                     |
| `src/__tests__/blossom.spec.ts`        | New — blossom algorithm unit tests                       |

## Acceptance criteria

1. All three fixture tests pass with exact bbpPairings expected output:
   - `dutch_2025_C5`: 1-5, 3-2, bye to 6
   - `dutch_2025_C9`: 2-1, 3-5, bye to 4
   - `issue_7`: exact 30 pairings matching bbpPairings output
2. `issue_15` (180 players, 11 rounds) completes without timeout
3. `pnpm lint && pnpm test && pnpm build` all pass
4. No `FIDE_EXACT_LIMIT` — all brackets use the same algorithm
5. No runtime dependencies

## Performance targets

- 60 players, round 15: < 100ms
- 180 players, round 11: < 500ms
- Theoretical: O(n³) per bracket

## Open questions

1. **Blossom implementation source:** should we port an existing implementation
   (e.g., from Python's networkx, or from the Galil-Micali-Gabow paper) or use a
   simpler O(n³) variant? bbpPairings uses Galil-Micali-Gabow.
2. **Weight calibration:** the exact weight formula needs to produce identical
   results to bbpPairings for the test fixtures. May require iterative tuning.
3. **C8 look-ahead:** still deferred (TODO in current code). The blossom
   approach doesn't inherently solve C8 either — it's a cross-bracket concern.

## Existing test fixtures with expected outputs (from bbpPairings)

### dutch_2025_C5 (round 3, 5 pairable players)

```
1 5
3 2
6 0
```

### dutch_2025_C9 (round 3, 5 pairable players)

```
2 1
3 5
4 0
```

### issue_7 (round 15, 60 players, 30 pairings)

```
1 15
3 2
11 17
7 10
8 14
4 6
5 12
9 16
13 25
24 22
18 29
20 23
19 33
21 38
39 26
28 36
31 40
37 35
44 46
30 32
27 48
47 42
51 55
34 50
49 45
53 58
41 59
56 43
60 52
54 57
```

### issue_7 bracket sizes (round 15)

| Score | Players                                 |
| ----- | --------------------------------------- |
| 10.5  | 1                                       |
| 10.0  | 1                                       |
| 9.5   | 3                                       |
| 9.0   | 5                                       |
| 8.5   | 2                                       |
| 8.0   | 9                                       |
| 7.5   | 3                                       |
| 7.0   | 10                                      |
| 6.5   | 5                                       |
| 6.0   | 11 (triggers FIDE_EXACT_LIMIT fallback) |
| 5.5   | 1                                       |
| 5.0   | 3                                       |
| 4.5   | 4                                       |
| 4.0   | 1                                       |
| 3.5   | 1                                       |
