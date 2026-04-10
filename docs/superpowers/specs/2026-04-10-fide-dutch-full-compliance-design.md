# FIDE Dutch (C.04.3) Full Compliance — Design

**Date:** 2026-04-10 **Issue:** #1 — full FIDE Dutch algorithm **Status:** Draft

---

## Goal

Rewrite `src/dutch.ts` to implement the full FIDE C.04.3 (Dutch) pairing
algorithm as specified in the 2026 edition. Replace the current simplified
blossom-weighted approach with the procedural bracket-by-bracket algorithm
defined in Articles 1-5.

## Decisions

| Decision       | Choice                          | Rationale                                                   |
| -------------- | ------------------------------- | ----------------------------------------------------------- |
| Scope          | Full C.04.3 compliance (C1-C21) | Not incremental — the algorithm is fundamentally different  |
| Algorithm      | Procedural FIDE spec            | Deterministic, auditable, matches reference implementations |
| TPN            | Player array index (1-indexed)  | No type changes needed, caller controls ordering            |
| blossom.ts     | Remove                          | Dead code after rewrite, recoverable from git               |
| File structure | Single-file rewrite             | Consistent with other pairing systems in the package        |
| Tests          | Existing 3 `.todo` tests first  | Expand coverage in follow-up                                |

## Public API

No changes. Same signature, same types:

```ts
pair(players: Player[], games: Game[][]): PairingResult
```

- `players` array order defines TPN (index 0 = TPN 1, index 1 = TPN 2, ...)
- `games[n]` = round n+1 (existing convention)
- Returns `{ pairings: Pairing[], byes: Bye[] }`

## Internal Data Model

New internal types in `dutch.ts` (not exported):

```ts
interface RankedPlayer {
  id: string;
  tpn: number; // 1-indexed, from array position
  score: number;
  colorDiff: number; // whites - blacks played
  colorHistory: Color[]; // sequence of colors played
  colorPreference: 'white' | 'black' | 'none';
  preferenceStrength: 'absolute' | 'strong' | 'mild' | 'none';
  isTopscorer: boolean;
  byeCount: number; // times received PAB
  unplayedRounds: number; // rounds with no game at all
  floatHistory: FloatKind[]; // per-round: 'down' | 'up' | null
}

type FloatKind = 'down' | 'up' | null;
type Color = 'white' | 'black';
```

`RankedPlayer` is computed once from `Player[]` and `Game[][]` at the start of
`pair()`. Float history is derived by comparing each player's score against
their opponent's score per round.

## Algorithm Structure

Follows FIDE C.04.3 Articles 1-5 directly.

### 1. Preprocessing

1. Compute `RankedPlayer` for each player from `players` and `games`.
2. Sort by score descending, then TPN ascending (Article 1.2).
3. Determine topscorer threshold: score > totalRounds / 2 (Article 1.8), where
   totalRounds = `games.length + 1` (including the round being paired).
4. Build score groups (Article 1.3.1).

### 2. Round-pairing loop (Article 1.9)

Process brackets top-down, starting with the highest score group:

```
for each bracket (starting from top score group):
  if bracket is homogeneous:
    pairHomogeneous(bracket)
  else:
    pairHeterogeneous(bracket)

  unpaired players become downfloaters -> added to next bracket
```

If one player remains after all brackets, they receive the PAB.

### 3. Homogeneous bracket pairing (Articles 3.2-3.6)

1. Compute MaxPairs = floor(bracketSize / 2).
2. Split into S1 (first MaxPairs players by Article 1.2 order) and S2 (rest).
3. Build candidate: pair S1[i] with S2[i].
4. Evaluate candidate against criteria C1-C21.
5. If not perfect:
   - Try transpositions of S2 (Article 4.2).
   - If exhausted, try exchanges between original S1 and S2 (Article 4.3).
   - After each alteration, rebuild and re-evaluate candidate.
6. If no perfect candidate exists: pick best available (Article 3.8).

### 4. Heterogeneous bracket pairing (Articles 3.2-3.7)

1. S1 = first M1 pairable MDPs. S2 = resident players. Limbo = remaining MDPs.
2. MDP-Pairing: pair S1[i] with S2[i].
3. Remaining residents form a remainder — pair as homogeneous (Article 3.3.3).
4. Candidate = MDP-Pairing + remainder candidate + Limbo downfloaters.
5. If candidate fails:
   - Transpose/exchange within the remainder (Article 3.7.1).
   - Transpose S2 for a new MDP-Pairing (Article 3.7.2).
   - Select next MDP set from Limbo (Article 3.7.3).

### 5. Candidate evaluation (Article 3.4)

Each candidate is evaluated against criteria in strict priority order. A
candidate is "perfect" if all criteria are satisfied. Otherwise, candidates are
compared lexicographically by their criterion violations.

**Absolute criteria (must pass):**

| Criterion | Rule                                                                      |
| --------- | ------------------------------------------------------------------------- |
| C1        | No rematches                                                              |
| C2        | PAB recipient hasn't already received PAB or scored a win without playing |
| C3        | Non-topscorers with same absolute color preference don't meet             |

**Completion criterion:**

| Criterion | Rule                                                          |
| --------- | ------------------------------------------------------------- |
| C4        | A valid pairing must exist for all remaining unpaired players |

**PAB criterion:**

| Criterion | Rule                           |
| --------- | ------------------------------ |
| C5        | Minimize score of PAB assignee |

**Quality criteria (optimize, descending priority):**

| Criterion | Rule                                                               |
| --------- | ------------------------------------------------------------------ |
| C6        | Minimize number of downfloaters (maximize pairs)                   |
| C7        | Minimize scores of downfloaters (descending order)                 |
| C8        | Next bracket remains pairable under C1-C7                          |
| C9        | Minimize unplayed games of PAB assignee                            |
| C10       | Minimize topscorers/opponents with \|colorDiff\| > 2               |
| C11       | Minimize topscorers/opponents with same color 3x in a row          |
| C12       | Minimize players not getting color preference                      |
| C13       | Minimize players not getting strong color preference               |
| C14       | Minimize resident downfloaters who downfloated previous round      |
| C15       | Minimize MDP opponents who upfloated previous round                |
| C16       | Minimize resident downfloaters who downfloated two rounds ago      |
| C17       | Minimize MDP opponents who upfloated two rounds ago                |
| C18       | Minimize score diffs of MDPs who downfloated previous round        |
| C19       | Minimize score diffs of MDP opponents who upfloated previous round |
| C20       | Minimize score diffs of MDPs who downfloated two rounds ago        |
| C21       | Minimize score diffs of MDP opponents who upfloated two rounds ago |

### 6. Transpositions (Article 4.2)

Permutations of BSNs in S2, ordered lexicographically by their first N1 elements
(N1 = |S1|). Generated lazily — yield the next transposition only when the
current candidate fails.

### 7. Exchanges (Article 4.3)

Swaps of equal-sized groups between original S1 and original S2. Ordered by the
4-level comparison from Article 4.3.2:

1. Smallest number of exchanged BSNs.
2. Smallest difference between sum of incoming and outgoing BSNs.
3. Largest differing BSN moved from S1 to S2.
4. Smallest differing BSN moved from S2 to S1.

Also generated lazily.

### 8. Color allocation (Article 5)

After pairings are determined, assign colors per Article 5 rules in priority
order:

1. (5.2.1) Grant both color preferences.
2. (5.2.2) Grant the stronger preference. If both absolute (topscorers), grant
   the wider color difference.
3. (5.2.3) Alternate colors to the most recent round where one had white and the
   other black.
4. (5.2.4) Grant the higher-ranked player's preference.
5. (5.2.5) If higher-ranked player has odd TPN, give them the initial-color;
   otherwise give the opposite. The initial-color is defined by FIDE as
   determined by lot before round 1. Since there is no lot mechanism in the API,
   we default to white. This is consistent with most pairing software.

## Utilities Changes

New internal helpers in `utilities.ts`:

- `floatHistory(playerId, games, allPlayers)` — compute per-round float status
  by comparing player score vs opponent score for each round.
- `isTopscorer(score, totalRounds)` — returns `score > totalRounds / 2`.
- `unplayedRounds(playerId, games)` — count rounds where player had no game (not
  even a bye).

Updated:

- `rankPlayers` — sort by score descending, then TPN ascending (instead of
  rating descending). TPN is passed as a map or derived from original array
  order.

Existing helpers (`score`, `colorHistory`, `colorPreference`, `hasFaced`,
`assignBye`, `scoreGroups`, etc.) remain unchanged.

## Files Changed

| File                                   | Change                                |
| -------------------------------------- | ------------------------------------- |
| `src/dutch.ts`                         | Full rewrite                          |
| `src/blossom.ts`                       | Delete                                |
| `src/utilities.ts`                     | Add helpers, update `rankPlayers`     |
| `src/__tests__/dutch.fixtures.spec.ts` | Convert 3 `.todo` tests to assertions |

## What Stays the Same

- All other pairing systems (dubov, burstein, lim, double-swiss, team).
- Public API signature and types (`Game`, `Player`, `Pairing`, `PairingResult`,
  `Bye`).
- Existing passing tests (structural correctness — count of pairings, no
  rematches).
- ESM-only, no runtime dependencies.
- Bye sentinel convention (`black: ''`).

## Performance Considerations

The procedural algorithm with transpositions and exchanges can be expensive for
large brackets. Worst case for a bracket of size N: O(N!) transpositions. In
practice:

- Most brackets are small (2-10 players in same score group).
- The first few transpositions usually succeed.
- Exchanges are tried only after all transpositions are exhausted.
- For the 180-player fixture (issue_15), the algorithm must complete 11 rounds
  without timeout.

If performance becomes an issue, we can add early termination heuristics or
limit the transposition search depth. But start with the correct algorithm
first.

## Open Questions

None — all decisions made during brainstorming.
