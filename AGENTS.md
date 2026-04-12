# AGENTS.md

Agent guidance for the `@echecs/swiss` package — Swiss tournament pairing and
standings algorithms following FIDE rules.

**See also:** [`REFERENCES.md`](REFERENCES.md) |
[`COMPARISON.md`](COMPARISON.md) | [`SPEC.md`](SPEC.md)

See the root `AGENTS.md` for workspace-wide conventions (package manager,
TypeScript settings, formatting, naming, testing, ESLint rules).

**Backlog:** tracked in
[GitHub Issues](https://github.com/echecsjs/swiss/issues).

---

## Project Overview

Pure algorithm library, no runtime dependencies. Exports one `pair` function via
six subpath imports — one per FIDE pairing system.

Each subpath exports a single `pair` function with the signature:

```ts
pair(players: Player[], games: Game[][]): PairingResult;
```

`Game[][]` is a round-indexed structure: `games[0]` contains round-1 games,
`games[1]` contains round-2 games, and so on. The `Game` type no longer has a
`round` field — round is determined by array position. There is no `round`
parameter on `pair`; the next round number is inferred from `games.length + 1`.

---

## Commands

### Build

```bash
pnpm run build          # bundle TypeScript → dist/ via tsdown
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
- C.04.4.3 Lim system: https://handbook.fide.com/chapter/C040403202602
- C.04.5 Double-Swiss system:
  https://handbook.fide.com/chapter/DoubleSwissSystem202602
- C.04.6 Swiss Team system:
  https://handbook.fide.com/chapter/SwissTeamPairingSystem202602

---

## Architecture Notes

- **ESM-only** — the package ships only ESM. Do not add a CJS build.
- No runtime dependencies — keep it that way.
- All shared internal logic (score, color history, bye eligibility, score
  groups) lives in `src/utilities.ts` and is NOT exported.
- Bye sentinel: a game with `black: ''` represents a bye awarded to `white`. All
  internal code filters these out appropriately.
- The Dutch system uses a blossom (maximum weight matching) algorithm
  implemented in `src/blossom.ts` — also internal, not exported.
- Round is structural: `games[n]` = round n+1. The `Game` type has no `round`
  field. The next round to pair is `games.length + 1`.
- All interface fields sorted alphabetically (`sort-keys` is an ESLint error).
- Always use `.js` extensions on relative imports (NodeNext resolution).

---

## Unified Pairing Interface

All pairing systems consumed by `@echecs/tournament` must conform to:

```typescript
type PairingSystem = (
  players: Standing[],
  games: Game[][],
  options?: object,
) => { pairings: Pairing[]; byes: Bye[] };
```

---

## Validation

Input validation is mostly provided by TypeScript's strict type system at
compile time. There is no runtime validation library — the type signatures
enforce correct usage. Do not add runtime type-checking guards (e.g. `typeof`
checks, assertion functions) unless there is an explicit trust boundary.

---

## Error Handling

- Throw `RangeError` for domain violations: fewer than 2 players, unknown player
  id in games.
- Throw `TypeError` for wrong argument types.

---

## Release Protocol

Step-by-step process for releasing a new version. CI auto-publishes to npm when
`version` in `package.json` changes on `main`.

1. **Verify the package is clean:**

   ```bash
   pnpm lint && pnpm test && pnpm build
   ```

   Do not proceed if any step fails.

2. **Decide the semver level:**
   - `patch` — bug fixes, internal refactors with no API change
   - `minor` — new features, new exports, non-breaking additions
   - `major` — breaking changes to the public API

3. **Update `CHANGELOG.md`** following
   [Keep a Changelog](https://keepachangelog.com) format:

   ```markdown
   ## [x.y.z] - YYYY-MM-DD

   ### Added

   - …

   ### Changed

   - …

   ### Fixed

   - …

   ### Removed

   - …
   ```

   Include only sections that apply. Use past tense.

4. **Update `README.md`** if the release introduces new public API, changes
   usage examples, or deprecates/removes existing features.

5. **Bump the version:**

   ```bash
   npm version <major|minor|patch> --no-git-tag-version
   ```

6. **Commit and push:**

   ```bash
   git add package.json CHANGELOG.md README.md
   git commit -m "release: @echecs/swiss@x.y.z"
   git push
   ```

   **The push is mandatory.** The release workflow only triggers on push to
   `main`. A commit without a push means the release never happens.

7. **CI takes over:** GitHub Actions detects the version bump, runs format →
   lint → test, and publishes to npm.

Do not manually publish with `npm publish`.
