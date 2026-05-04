# Changelog

## [3.1.3] - 2026-05-04

### Fixed

- Half-byes (0.5 pts) and zero-byes (0 pts) incorrectly made players ineligible
  for future bye assignment. Only byes awarding >= 1 point (pairing byes, full
  byes, forfeit wins) should affect eligibility, matching bbpPairings'
  `eligibleForBye` semantics.
- Byes were not counted as unplayed rounds. In bbpPairings all bye types have
  `gameWasPlayed=false`, so they contribute to the C9 criterion (minimize
  unplayed games of bye assignee). This resolves the last remaining discrepancy
  in the FIDE endorsement test (5000 seeds).

## [3.1.2] - 2026-05-04

### Fixed

- Zero-byes unconditionally assigned FLOAT_DOWN. bbpPairings only assigns
  FLOAT_DOWN when the bye awards more points than a loss; zero-byes give 0
  points, so they should get FLOAT_NONE. This inflated C14-C17 float history
  bits in edge weights for players who received zero-byes.

## [3.1.1] - 2026-05-03

### Fixed

- C11 edge weight used signed `colorDiff` instead of absolute color imbalance
  when comparing two players with absolute color preferences. When both players
  had negative color differences, the signed comparison picked the wrong
  player's `repeatedColor` to check, producing suboptimal matchings that
  violated strong color preferences.
- `strongColorPreference` predicate incorrectly included absolute preferences.
  bbpPairings defines strong and absolute as mutually exclusive; fixed to match.

## [3.1.0] - 2026-05-01

### Added

- structured trace system for pairing algorithm observability
  (`PairOptions.trace`, `TraceEvent` types) with events across blossom, pairing,
  and dutch layers.
- `@echecs/tournament` as a peer dependency — shared types (`Game`, `Player`,
  `Pairing`, `Bye`, `PairingResult`, `Result`, `GameKind`) are now re-exported
  from tournament instead of defined locally.

### Changed

- rewrote Dutch pairing system to implement full FIDE C.04.3 (2026 edition) with
  all 21 criteria, bracket-by-bracket blossom matching, MDP selection, and
  remainder phase.
- consolidated FIDE Article 5.2 colour rules into shared `FIDE_COLOR_RULES` and
  `ROUND_1_COLOR_RULE` in `utilities.ts` — removes ~220 lines of duplication
  across Dutch, Dubov, Burstein, and Lim.
- extracted shared `buildBlossomEdges`, `runBlossom`, and `normaliseGames` into
  `pairing-helpers.ts` and `utilities.ts`.
- `const enum Label` changed to `enum Label` for rolldown/tsdown compatibility.

## [3.0.3] - 2026-04-17

### Fixed

- Added top-level `types` field to `package.json` for TypeScript configs that
  don't resolve types through `exports` conditions.

## 3.0.2 — 2026-04-09

### Changed

- updated description to list all six pairing systems and remove
  tiebreak/standings claims
- removed misleading keywords (`buchholz`, `standings`, `tiebreak`)
- added `double`, `lim`, and `team` keywords

## 3.0.1 — 2026-04-09

### Fixed

- Documented `GameKind` and `Result` types in the Types section.
- Added `Game.kind` field to the documented `Game` interface.
- Fixed double-swiss example field names (`whiteId`/`blackId` →
  `white`/`black`).

## 2.0.0 — 2026-03-24

### Changed

- **BREAKING:** Renamed `Game.blackId` → `Game.black`, `Game.whiteId` →
  `Game.white`.
- **BREAKING:** Renamed `Pairing.blackId` → `Pairing.black`, `Pairing.whiteId` →
  `Pairing.white`.
- **BREAKING:** Renamed `Bye.playerId` → `Bye.player`.

## 1.0.0 — 2026-03-23

### Changed

- **BREAKING:** `Game` type no longer has a `round` field. Round is determined
  by array position: `games[n]` = round n+1.
- **BREAKING:** All pairing functions renamed to `pair()`.
- **BREAKING:** `round` parameter removed — derived from `games.length + 1`.
- **BREAKING:** Subpath exports added: `@echecs/swiss/dutch`,
  `@echecs/swiss/dubov`, `@echecs/swiss/burstein`, `@echecs/swiss/lim`,
  `@echecs/swiss/double`, `@echecs/swiss/team`.

### Removed

- `standings()` function — use `@echecs/tournament` instead.
- All tiebreak functions (`buchholz`, `buchholzCut`, `medianBuchholz`,
  `sonnebornBerger`, `progressive`, `directEncounter`) — use the standalone
  `@echecs/*` tiebreak packages instead.
- `Standing` and `Tiebreak` types.
