# Changelog

## [3.0.3] - 2026-04-17

### Fixed

- Added top-level `types` field to `package.json` for TypeScript configs that
  don't resolve types through `exports` conditions.

## [Unreleased]

### Changed

- rewrote Dutch pairing system to implement full FIDE C.04.3 (2026 edition) with
  all 21 criteria, replacing the simplified blossom-weighted approach
- player array order now determines Tournament Pairing Number (TPN) for Dutch
  pairings

### Removed

- removed internal `blossom.ts` (maximum weight matching no longer used by Dutch
  system)

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
