# Changelog

## 0.1.2 — 2026-03-22

### Fixed

- Copied TRF fixture files into the repo so CI tests no longer depend on the
  monorepo sibling directory

## 0.1.1 — 2026-03-21

### Fixed

- Replaced local `file:` dependency on `@echecs/trf` with published npm version
  to fix CI install failures

## 0.1.0 — 2026-03-17

- Initial release
- Dutch, Dubov, and Burstein pairing systems (FIDE C.04.3, C.04.4.1, C.04.4.2)
- `standings()` with pluggable tiebreaks
- Six built-in tiebreak functions: `buchholz`, `buchholzCut`, `medianBuchholz`,
  `sonnebornBerger`, `progressive`, `directEncounter`
- Fixture tests from bbpPairings (Apache 2.0)
