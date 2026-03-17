# Specification: FIDE Swiss Pairing Systems

Implements three FIDE-approved Swiss pairing systems as defined in the
[FIDE Handbook §C.04](https://handbook.fide.com/chapter/C0401202507)
(effective 1 February 2026).

---

## Basic Rules (C.04.1)

1. No two players shall meet more than once.
2. A player who has received a bye or has a forfeit win shall not receive
   another bye.
3. Colors shall be allocated as equitably as possible.
4. The color difference (whites minus blacks) shall not exceed +2 or be
   less than -2 at any time.
5. No player shall receive the same color more than twice in a row.

---

## Pairing Systems

### Dutch System (C.04.3)

The default FIDE Swiss system. Within each score group:
1. Sort players by score descending, then rating descending.
2. Split the group into top half (S1) and bottom half (S2).
3. Pair S1[1] with S2[1], S1[2] with S2[2], etc.
4. If a pairing violates a basic rule, apply downfloats (move players to
   lower score groups) following criteria C1–C21.

Reference: [C.04.3](https://handbook.fide.com/chapter/C0403202602)

### Dubov System (C.04.4.1)

Within each score group, pair the highest-ranked player against the
second-highest, rank 3 against rank 4, etc. (adjacent pairing).

Reference: [C.04.4.1](https://handbook.fide.com/chapter/C040401202602)

### Burstein System (C.04.4.2)

Within each score group, pair rank 1 against rank last, rank 2 against
rank second-to-last, etc. (top-vs-bottom pairing).

Reference: [C.04.4.2](https://handbook.fide.com/chapter/C040402202602)

---

## Tiebreak Systems

### Buchholz (BH)

Sum of the final scores of all opponents.

### Buchholz Cut-1 (BH-1)

Buchholz minus the lowest opponent score.

### Median Buchholz (MBH)

Buchholz minus the lowest and highest opponent scores.

### Sonneborn-Berger (SB)

Sum of `result × opponent_final_score` for each game played.

### Progressive Score (PS)

Sum of cumulative scores after each round:
`PS = score_after_r1 + score_after_r2 + ... + score_after_rn`

### Direct Encounter (DE)

Score in games played only against tied opponents (those with the same
final score).

---

## Byes

- A bye is awarded to the lowest-ranked player who has not yet received one
  when the number of players is odd.
- A bye counts as 1 point for scoring purposes.
- Represented internally as `{ whiteId: playerId, blackId: '', result: 1, round }`.

---

## Implementation Notes

- `dutch(players, games, round)` — simplified blossom-weighted approach;
  full C1–C21 criteria not yet implemented (3 fixture tests are `.todo`)
- `burstein(players, games, round)` — greedy, no blossom needed
- `dubov(players, games, round)` — greedy, no blossom needed
- `standings(players, games, tiebreaks[])` — pluggable tiebreak functions
- All pairing functions throw `RangeError` for `round < 1` or `< 2 players`

## Known Deviations

- Dutch: cross-group floaters (criteria C5, C9) not yet correctly
  implemented — tracked as `.todo` tests in `dutch.fixtures.spec.ts`

## Sources

- [FIDE C.04.1](https://handbook.fide.com/chapter/C0401202507)
- [FIDE C.04.3](https://handbook.fide.com/chapter/C0403202602)
- [FIDE C.04.4.1](https://handbook.fide.com/chapter/C040401202602)
- [FIDE C.04.4.2](https://handbook.fide.com/chapter/C040402202602)
