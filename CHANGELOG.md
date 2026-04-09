# Changelog

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
