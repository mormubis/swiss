# AGENTS.md

Agent guidance for the `@echecs/swiss` package — Swiss tournament pairing and
standings algorithms following FIDE rules.

See the root `AGENTS.md` for workspace-wide conventions (package manager,
TypeScript settings, formatting, naming, testing, ESLint rules).

---

## Project Overview

Pure algorithm library, no runtime dependencies. Exports three pairing functions
(`dutch`, `burstein`, `dubov`), one standings function (`standings`), and six
tiebreak functions (`buchholz`, `buchholzCut`, `medianBuchholz`,
`sonnebornBerger`, `progressive`, `directEncounter`).

---

## FIDE References

- C.04.1 Basic rules: https://handbook.fide.com/chapter/C0401202507
- C.04.3 Dutch system: https://handbook.fide.com/chapter/C0403202602
- C.04.4.1 Dubov system: https://handbook.fide.com/chapter/C040401202602
- C.04.4.2 Burstein system: https://handbook.fide.com/chapter/C040402202602

---

## Architecture Notes

- No runtime dependencies — keep it that way.
- All shared internal logic (score, color history, bye eligibility, score
  groups) lives in `src/utils.ts` and is NOT exported.
- Bye sentinel: a game with `blackId: ''` represents a bye awarded to `whiteId`.
  All internal code filters these out appropriately.
- The Dutch system uses a blossom (maximum weight matching) algorithm
  implemented in `src/blossom.ts` — also internal, not exported.
- All interface fields sorted alphabetically (`sort-keys` is an ESLint error).
- Always use `.js` extensions on relative imports (NodeNext resolution).

---

## Error Handling

- Throw `RangeError` for domain violations: `round < 1`, fewer than 2 players,
  unknown player id in games.
- Throw `TypeError` for wrong argument types.
