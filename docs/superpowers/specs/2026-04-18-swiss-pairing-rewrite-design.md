# Swiss Pairing Rewrite Design

**Date:** 2026-04-18 **Scope:** full rewrite of all six FIDE pairing systems

---

## Overview

Rewrite the `@echecs/swiss` pairing engine from scratch. Six FIDE pairing
systems: Dutch (C.04.3), Dubov (C.04.4.1), Burstein (C.04.4.2), Lim (C.04.4.3),
Double-Swiss (C.04.5), and Swiss Team (C.04.6).

The public API stays the same:

```ts
pair(players: Player[], games: Game[][]): PairingResult;
```

One `pair` export per subpath, one subpath per system.

## Approach

Weighted blossom matching for Dutch, Dubov, Burstein, and Lim. Lexicographic
enumeration for Double-Swiss and Swiss Team.

The FIDE spec defines criteria priority and candidate ordering. Rather than
enumerating candidates (factorial blowup for brackets > 16 players), we encode
all criteria as a single arbitrary-precision edge weight and let Edmonds'
blossom algorithm find the optimal matching in O(n^3). This is the same approach
used by bbpPairings, the primary FIDE-endorsed engine.

Double-Swiss and Swiss Team have simpler criteria (just C1 + color allocation)
and use lexicographic matching identifiers per their respective specs. The
existing enumeration approach works fine for these -- brackets are small and the
search space is manageable.

## Module 1: `DynamicUint`

Mutable arbitrary-precision unsigned integer backed by `Uint32Array`.

### Why not BigInt

`BigInt` allocates a new immutable object per operation, creating GC pressure.
Performance varies across JS engines. A mutable `Uint32Array`-backed
implementation avoids allocation, allows in-place mutation, and gives
predictable performance. Matches bbpPairings' `DynamicUint` concept.

### Internal representation

Array of 32-bit unsigned words, little-endian (word 0 = least significant).
Grows on demand via `shiftGrow`. 32-bit words because JS bitwise operators work
on 32 bits natively.

### API

```ts
class DynamicUint {
  static zero(words: number): DynamicUint;
  static from(value: number): DynamicUint;

  // Bit manipulation (mutating, in-place, return this)
  shiftLeft(bits: number): this;
  shiftRight(bits: number): this;
  shiftGrow(bits: number): this;
  or(value: number): this;
  or(value: DynamicUint): this;
  and(value: number): this;
  add(value: number): this;
  add(value: DynamicUint): this;
  subtract(value: number): this;
  subtract(value: DynamicUint): this;

  // Comparison
  compareTo(other: DynamicUint): -1 | 0 | 1;
  isZero(): boolean;

  // Utility
  clone(): DynamicUint;
  words: number;
}
```

### Operations needed

Only the operations listed above. No multiplication, division, modulo, or
bitwise XOR. The blossom algorithm needs `add`, `subtract`, `compareTo`. The
weight encoder needs `shiftGrow`, `shiftLeft`, `or`, `and`.

## Module 2: Blossom Algorithm

Edmonds' maximum-weight matching on a general (non-bipartite) graph using
`DynamicUint` weights.

### Interface

```ts
function maximumWeightMatching(
  vertexCount: number,
  edges: { u: number; v: number; weight: DynamicUint }[],
): number[];
```

Returns an array where `result[i]` = matched partner of vertex `i`, or `i` if
unmatched.

### Behavior

- Maximizes total weight of the matching.
- Incompatible pairs have weight 0 -- the blossom naturally avoids them.
- Completability is encoded as the highest-priority bits, so the blossom first
  maximizes cardinality (number of pairs), then quality.
- Dense graph representation: adjacency matrix of `DynamicUint`.

### Complexity

O(n^3) time, O(n^2) space.

## Module 3: Utilities (`PlayerState` + shared logic)

### `PlayerState`

Precomputed once per `pair()` call. Eliminates repeated O(rounds \* games)
scans.

```ts
interface PlayerState {
  byeCount: number;
  colorDiff: number;
  colorHistory: Color[];
  floatHistory: FloatKind[];
  id: string;
  opponents: Set<string>;
  preferenceStrength: 'absolute' | 'mild' | 'none' | 'strong';
  preferredColor: Color | undefined;
  score: number;
  tpn: number;
  unplayedRounds: number;
}
```

Fields sorted alphabetically per project convention.

### Shared functions

- `buildPlayerStates(players, games)` -- builds all `PlayerState` objects.
- `scoreGroups(states)` -- returns `Map<number, PlayerState[]>` sorted by score
  descending.
- `hasFaced(a, b)` -- O(1) via `a.opponents.has(b.id)`.
- `colorPreference(state)` -- derives preference strength from color history.
  Absolute when `|colorDiff| > 1` or same color twice in a row. Strong when
  `|colorDiff| === 1`. Mild when `colorDiff === 0`. Shared across all systems.
- `assignBye(states, games, tiebreak)` -- parameterized bye selection. Each
  system provides its own tiebreak comparator.

### Color allocation engine

```ts
type ColorRule = (
  hrp: PlayerState,
  opponent: PlayerState,
) => 'hrp-white' | 'hrp-black' | 'continue';

function allocateColor(
  a: PlayerState,
  b: PlayerState,
  rules: ColorRule[],
): { white: string; black: string };
```

Determines HRP (higher-ranked player by score, then system-specific ranking),
then walks the rule list until one returns a decision.

## Module 4: Weight Encoding

Data-driven weight builder shared by all blossom-based systems.

### Interface

```ts
interface Criterion {
  bits: number | ((ctx: BracketContext) => number);
  evaluate: (a: PlayerState, b: PlayerState, ctx: BracketContext) => number;
}

function buildEdgeWeight(
  criteria: Criterion[],
  a: PlayerState,
  b: PlayerState,
  context: BracketContext,
): DynamicUint;
```

The `bits` field is either a static number or a function of `BracketContext`.
Static for fixed-width criteria (e.g. completability = 2 bits). Dynamic for
criteria whose width depends on tournament structure (e.g. C7 uses
`scoreGroupsShift` bits, C14 uses `scoreGroupSizeBits`).

### BracketContext

```ts
interface BracketContext {
  byeAssigneeScore: number;
  isSingleDownfloaterTheByeAssignee: boolean;
  scoreGroupSizeBits: number;
  scoreGroupShifts: Map<number, number>;
  scoreGroupsShift: number;
  tournament: { playedRounds: number; expectedRounds: number };
}
```

### Dutch criteria (C6-C21)

Weight layout from highest bits to lowest:

| Bits      | Criterion      | FIDE rule                                     | Encoding               |
| --------- | -------------- | --------------------------------------------- | ---------------------- |
| 2         | Completability | C4+C5                                         | `2 - byeEligibleCount` |
| sgBits    | C6             | Maximize pairs in current bracket             | `1` if both in bracket |
| sgsShift  | C7             | Maximize scores paired                        | Score-bitmap           |
| sgBits    | C8             | Maximize pairs in next bracket                | `1` if both in next    |
| sgsShift  | C8b            | Maximize scores in next bracket               | Score-bitmap           |
| 2\*sgBits | C9             | Minimize unplayed games of bye assignee       | Played games rank      |
| sgBits    | C10            | Topscorer colorDiff ≤ 2                       | `1` if no violation    |
| sgBits    | C11            | Topscorer no 3x same color                    | `1` if no violation    |
| sgBits    | C12            | Grant color preferences                       | `1` if compatible      |
| sgBits    | C13            | Grant strong/absolute prefs                   | `1` if compatible      |
| sgBits    | C14            | No repeat downfloat (round -1)                | Count non-repeated     |
| sgBits    | C15            | No repeat upfloat (round -1)                  | `1` if no repeat       |
| sgBits    | C16            | No repeat downfloat (round -2)                | Count non-repeated     |
| sgBits    | C17            | No repeat upfloat (round -2)                  | `1` if no repeat       |
| sgsShift  | C18            | Scores of repeat downfloaters (-1)            | Score-bitmap           |
| sgsShift  | C19            | Scores of opponents of repeat upfloaters (-1) | Score-bitmap           |
| sgsShift  | C20            | Scores of repeat downfloaters (-2)            | Score-bitmap           |
| sgsShift  | C21            | Scores of opponents of repeat upfloaters (-2) | Score-bitmap           |
| 3\*sgBits | Ordering       | BSN tiebreak                                  | BSN-based bits         |

Where `sgBits` = `scoreGroupSizeBits`, `sgsShift` = `scoreGroupsShift`.

### Other systems' criteria

Dubov, Burstein, and Lim define their own `Criterion[]` arrays with fewer
entries. The weight builder function is the same -- only the configuration
changes.

## Module 5: Per-System Logic

### Dutch (C.04.3)

- **Ranking:** score descending, TPN ascending.
- **Criteria:** 16 (C6-C21) as described above.
- **Color rules:** C.04.1 Article 4.5 (HRP-based, 7 rules).
- **Bye tiebreak:** lowest score, then highest TPN.
- **Bracket traversal:** top-down, MDPs carry into next bracket.

### Dubov (C.04.4.1)

- **Ranking:** score descending, ARO (Average Rating of Opponents) descending,
  TPN ascending.
- **Criteria:** 10 criteria. Simpler float rules, no C16-C21 (only considers
  last round, not round -2).
- **Color rules:** same as Dutch (C.04.1 Article 4.5).
- **Bye tiebreak:** lowest score, then highest TPN.
- **Bracket traversal:** top-down with MDPs. G1/G2 color group split, shifters,
  T2 transpositions encoded as weight preferences.

### Burstein (C.04.4.2)

- **Ranking:** score descending, BSN via Buchholz then Sonneborn-Berger index.
- **Criteria:** 10 criteria. Similar to Dubov.
- **Color rules:** same as Dutch.
- **Bye tiebreak:** lowest score, then ranking order (not TPN).
- **Bracket traversal:** top-down with MDPs. BSN-based lexicographic ordering
  with virtual zeroes.

### Lim (C.04.4.3)

- **Ranking:** score descending, TPN ascending.
- **Criteria:** ~12 criteria. Includes compatibility constraints stricter than
  Dutch.
- **Color rules:** same as Dutch.
- **Bye tiebreak:** lowest score, then ranking order.
- **Bracket traversal:** bi-directional (top and bottom score groups
  simultaneously, meeting in the middle). Requires modified bracket-by-bracket
  processing.

### Double-Swiss (C.04.5)

- **Ranking:** score descending, TPN ascending.
- **Matching:** lexicographic enumeration (FIDE matching identifiers).
- **Color rules:** C.04.5 Article 4.3 (5 rules, HRP-based).
- **Bye tiebreak:** lowest score, most matches played, highest TPN.
- **Note:** each round is a two-game match. PAB awards 1.5 points.

### Swiss Team (C.04.6)

- **Ranking:** score descending, TPN ascending.
- **Matching:** lexicographic enumeration.
- **Color rules:** C.04.6 Article 4.3 (9 rules, first-team-based, includes Type
  A preference checks).
- **Bye tiebreak:** lowest score, most matches played, highest TPN.

## Algorithm Flow (Blossom-Based Systems)

```
pair(players, games):
  1. states = buildPlayerStates(players, games)
  2. sorted = sort states by system-specific ranking
  3. groups = scoreGroups(sorted)

  FEASIBILITY PASS:
  4. Build full graph (all players, all edges)
  5. Compute basic weights (completability + bye eligibility + score pairing)
  6. Run blossom
  7. Check matching is complete. If not, throw RangeError.
  8. Determine byeAssigneeScore from the unmatched player
  9. Compute isSingleDownfloaterTheByeAssignee

  BRACKET-BY-BRACKET PASS:
  10. For each score group (top to bottom):
      a. Current bracket = score group players + carried-down MDPs
      b. Include next score group players in the graph
      c. Compute full weights with known byeAssigneeScore
      d. Run blossom
      e. Lock matched pairs from current bracket (finalizePair)
      f. Carry unmatched current-bracket players as downfloaters

  COLOR ALLOCATION:
  11. For each matched pair, allocateColor(a, b, system rules)

  BYE:
  12. If odd players, assignBye(states, games, system tiebreak)

  13. Return { pairings, byes }
```

## File Structure

```
src/
  types.ts              # Public types (Player, Game, Pairing, Bye, etc.)
  dynamic-uint.ts       # DynamicUint class
  blossom.ts            # Edmonds' blossom with DynamicUint
  utilities.ts          # PlayerState, score groups, shared logic

  # Weight encoding
  weights.ts            # buildEdgeWeight, Criterion, BracketContext

  # Blossom-based systems
  dutch.ts              # Dutch Criterion[], ColorRule[], ranking, bracket logic
  dubov.ts              # Dubov-specific config
  burstein.ts           # Burstein-specific config
  lim.ts                # Lim-specific config (bi-directional traversal)

  # Lexicographic systems
  lexicographic.ts      # Shared enumeration, matching identifiers
  double-swiss.ts       # Double-Swiss color allocation + lexicographic
  swiss-team.ts         # Swiss Team color allocation + lexicographic

  # Entry points
  dutch-entry.ts
  dubov-entry.ts
  burstein-entry.ts
  lim-entry.ts
  double-entry.ts
  team-entry.ts

  index.ts              # Re-exports
```

## Error Handling

- `RangeError` for fewer than 2 players.
- `RangeError` for unknown player id in games.
- `RangeError` when no valid pairing exists (blossom can't produce a complete
  matching satisfying absolute criteria).
- No runtime type validation (TypeScript handles this at compile time).

## Complexity

- **Dutch/Dubov/Burstein/Lim:** O(n^3 _ s^2 _ log n) where n = players, s =
  number of occupied score groups.
- **Double-Swiss/Swiss Team:** O(n!) worst case per bracket, but brackets are
  small in practice. Acceptable for these systems.

## Constraints

- ESM-only, no runtime dependencies.
- All internal modules not exported.
- `.js` extensions on relative imports (NodeNext resolution).
- Interface fields sorted alphabetically.
- Bye sentinel: `black: ''` represents a bye awarded to `white`.

## FIDE References

- C.04.1 Basic rules: https://handbook.fide.com/chapter/C0401202507
- C.04.3 Dutch: https://handbook.fide.com/chapter/C0403202602
- C.04.4.1 Dubov: https://handbook.fide.com/chapter/C040401202602
- C.04.4.2 Burstein: https://handbook.fide.com/chapter/C040402202602
- C.04.4.3 Lim: https://handbook.fide.com/chapter/C040403202602
- C.04.5 Double-Swiss: https://handbook.fide.com/chapter/DoubleSwissSystem202602
- C.04.6 Swiss Team:
  https://handbook.fide.com/chapter/SwissTeamPairingSystem202602
- bbpPairings reference: https://github.com/BieremaBoyzProgramming/bbpPairings
