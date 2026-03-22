# Swiss

[![npm](https://img.shields.io/npm/v/@echecs/swiss)](https://www.npmjs.com/package/@echecs/swiss)
[![Test](https://github.com/mormubis/swiss/actions/workflows/test.yml/badge.svg)](https://github.com/mormubis/swiss/actions/workflows/test.yml)
[![Coverage](https://codecov.io/gh/mormubis/swiss/branch/main/graph/badge.svg)](https://codecov.io/gh/mormubis/swiss)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Swiss** is a TypeScript library for Swiss chess tournament pairing and
standings, following
[FIDE rules](https://handbook.fide.com/chapter/C0401202507). Zero runtime
dependencies.

Four FIDE-approved pairing systems are supported: Dutch (C.04.3), Dubov
(C.04.4.1), Burstein (C.04.4.2), and Double-Swiss (C.04.5). Six built-in
tiebreak functions are included, all pluggable and composable.

## Installation

```bash
npm install @echecs/swiss
```

## Quick Start

```typescript
import { dutch, standings, buchholz, sonnebornBerger } from '@echecs/swiss';
import type { Game, Player } from '@echecs/swiss';

const players: Player[] = [
  { id: 'alice', rating: 2100 },
  { id: 'bob', rating: 1950 },
  { id: 'carol', rating: 1870 },
  { id: 'dave', rating: 1820 },
];

// Pair round 1 (no games played yet)
const round1 = dutch(players, [], 1);
console.log(round1.pairings);
// [{ whiteId: 'alice', blackId: 'carol' }, { whiteId: 'bob', blackId: 'dave' }]

// Submit results
const games: Game[] = [
  { whiteId: 'alice', blackId: 'carol', result: 1, round: 1 },
  { whiteId: 'bob', blackId: 'dave', result: 0.5, round: 1 },
];

// Pair round 2
const round2 = dutch(players, games, 2);

// Compute standings after round 1
const table = standings(players, games, [buchholz, sonnebornBerger]);
console.log(table[0]);
// { playerId: 'alice', rank: 1, score: 1, tiebreaks: [1, 1] }
```

## API

### Pairing functions

All three pairing systems share the same signature:

```typescript
function dutch(players: Player[], games: Game[], round: number): PairingResult;
function dubov(players: Player[], games: Game[], round: number): PairingResult;
function burstein(
  players: Player[],
  games: Game[],
  round: number,
): PairingResult;
```

- `players` — all registered players in the tournament
- `games` — all completed games across all previous rounds
- `round` — the round number to pair (1-based)

Throws `RangeError` for `round < 1` or fewer than 2 players.

```typescript
interface PairingResult {
  byes: Bye[]; // players with no opponent this round
  pairings: Pairing[]; // white/black assignments
}

interface Pairing {
  blackId: string;
  whiteId: string;
}

interface Bye {
  playerId: string;
}
```

### Pairing systems

| Function      | FIDE rule | Description                                                           |
| ------------- | --------- | --------------------------------------------------------------------- |
| `dutch`       | C.04.3    | Default FIDE system — top half vs bottom half within each score group |
| `dubov`       | C.04.4.1  | Adjacent pairing — rank 1 vs rank 2, rank 3 vs rank 4, etc.           |
| `burstein`    | C.04.4.2  | Rank 1 vs rank last, rank 2 vs rank second-to-last, etc.              |
| `doubleSwiss` | C.04.5    | Two-game match Swiss — each pairing is a two-game match               |

### `standings()`

```typescript
function standings(
  players: Player[],
  games: Game[],
  tiebreaks: Tiebreak[],
): Standing[];
```

Returns players ranked by score, with tiebreaks applied in the order supplied.
Each `Standing` entry includes the computed tiebreak values in `tiebreaks[]`.

```typescript
interface Standing {
  playerId: string;
  rank: number;
  score: number;
  tiebreaks: number[]; // one value per tiebreak function, in order
}
```

### Built-in tiebreaks

All conform to the `Tiebreak` type and can be passed directly to `standings()`:

```typescript
type Tiebreak = (playerId: string, players: Player[], games: Game[]) => number;
```

| Function          | Description                                            |
| ----------------- | ------------------------------------------------------ |
| `buchholz`        | Sum of all opponents' final scores                     |
| `buchholzCut`     | Buchholz minus the single lowest opponent score        |
| `medianBuchholz`  | Buchholz minus both lowest and highest opponent scores |
| `sonnebornBerger` | Sum of (result × opponent's score) for each game       |
| `progressive`     | Sum of cumulative scores after each round              |
| `directEncounter` | Score in games between tied players only               |

### Custom tiebreaks

Any function matching the `Tiebreak` signature works:

```typescript
import { standings } from '@echecs/swiss';
import type { Game, Player, Tiebreak } from '@echecs/swiss';

const numberOfWins: Tiebreak = (playerId, _players, games) =>
  games.filter(
    (g) =>
      (g.whiteId === playerId && g.result === 1) ||
      (g.blackId === playerId && g.result === 0),
  ).length;

const table = standings(players, games, [numberOfWins]);
```

### Double-Swiss matches

In Double-Swiss (`doubleSwiss`), each pairing is a two-game match. Record both
games with the same `round` number:

```typescript
import { doubleSwiss } from '@echecs/swiss';

const round1 = doubleSwiss(players, [], 1);
// round1.pairings[0] = { whiteId: 'alice', blackId: 'bob' }

// Record both games of the match
const games: Game[] = [
  { whiteId: 'alice', blackId: 'bob', result: 1, round: 1 }, // game 1
  { whiteId: 'bob', blackId: 'alice', result: 0.5, round: 1 }, // game 2
];
// Alice scored 1 + 0.5 = 1.5 points for this match
```

A Double-Swiss bye awards 1.5 points (one win + one draw), recorded as two game
entries with `blackId: ''`:

```typescript
const byeGames: Game[] = [
  { whiteId: 'carol', blackId: '', result: 1, round: 1 },
  { whiteId: 'carol', blackId: '', result: 0.5, round: 1 },
];
```

### Byes

A bye is represented as a `Game` with `blackId: ''` (empty string). The player
in `whiteId` receives the bye point. Pass it in `games` alongside real games:

```typescript
const games: Game[] = [
  { whiteId: 'alice', blackId: 'carol', result: 1, round: 1 },
  { whiteId: 'bob', blackId: '', result: 1, round: 1 }, // bye for bob
];
```

### Using with `@echecs/trf`

To pair a tournament loaded from a TRF file, adapt the types:

```typescript
import parse from '@echecs/trf';
import { dutch } from '@echecs/swiss';
import type { Tournament } from '@echecs/trf';
import type { Game, Player } from '@echecs/swiss';

function toPlayers(t: Tournament): Player[] {
  return t.players.map((p) => ({
    id: String(p.pairingNumber),
    rating: p.rating,
  }));
}

function toGames(t: Tournament): Game[] {
  const games: Game[] = [];
  for (const player of t.players) {
    for (const r of player.results) {
      if (r.color !== 'w' || r.opponentId === null) continue;
      let result: 0 | 0.5 | 1;
      if (r.result === '1' || r.result === '+') result = 1;
      else if (r.result === '0' || r.result === '-') result = 0;
      else if (r.result === '=') result = 0.5;
      else continue;
      games.push({
        blackId: String(r.opponentId),
        result,
        round: r.round,
        whiteId: String(player.pairingNumber),
      });
    }
  }
  return games;
}

const tournament = parse(trfString)!;
const pairings = dutch(toPlayers(tournament), toGames(tournament), 5);
```

## Types

```typescript
interface Player {
  id: string;
  rating?: number; // used for seeding in round 1
}

interface Game {
  blackId: string; // '' for a bye
  result: Result; // from white's perspective
  round: number;
  whiteId: string;
}

type Result = 0 | 0.5 | 1;
```

## FIDE References

- [C.04.1 Basic rules](https://handbook.fide.com/chapter/C0401202507)
- [C.04.3 Dutch system](https://handbook.fide.com/chapter/C0403202602)
- [C.04.4.1 Dubov system](https://handbook.fide.com/chapter/C040401202602)
- [C.04.4.2 Burstein system](https://handbook.fide.com/chapter/C040402202602)
- [C.04.5 Double-Swiss system](https://handbook.fide.com/chapter/DoubleSwissSystem202602)

## License

MIT
