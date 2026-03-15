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

## Commands

### Build

```bash
pnpm run build          # compile TypeScript → dist/ (tsconfig.build.json)
```

### Test

```bash
pnpm run test                          # run all tests once
pnpm run test:watch                    # watch mode
pnpm run test:coverage                 # with coverage report

# Run a single test file
pnpm run test src/__tests__/index.spec.ts

# Run a single test by name (substring match)
pnpm run test -- --reporter=verbose -t "dutch"
```

### Lint & Format

```bash
pnpm run lint           # ESLint + tsc type-check (auto-fixes style issues)
pnpm run lint:ci        # strict — zero warnings allowed, no auto-fix
pnpm run lint:style     # ESLint only (auto-fixes)
pnpm run lint:types     # tsc --noEmit type-check only
pnpm run format         # Prettier (writes changes)
pnpm run format:ci      # Prettier check only (no writes)
```

### Full pre-PR check

```bash
pnpm lint && pnpm test && pnpm build
```

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
  groups) lives in `src/utilities.ts` and is NOT exported.
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

---

## Publishing

The package is published as `@echecs/swiss`. A GitHub Actions workflow publishes
automatically when the `version` field in `package.json` is bumped on `main`. Do
not manually publish. Always update `CHANGELOG.md` alongside any version bump.
Bump patch for fixes, minor for new features, major for breaking changes.
