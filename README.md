# Swiss

[![npm](https://img.shields.io/npm/v/@echecs/swiss)](https://www.npmjs.com/package/@echecs/swiss)
[![Coverage](https://codecov.io/gh/echecsjs/swiss/branch/main/graph/badge.svg)](https://codecov.io/gh/echecsjs/swiss)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Swiss** is a TypeScript library for Swiss chess tournament pairing, following
[FIDE rules](https://handbook.fide.com/chapter/C0401202507).

Six FIDE-approved pairing systems are supported via subpath exports: Dutch
(C.04.3), Dubov (C.04.4.1), Burstein (C.04.4.2), Lim (C.04.4.3), Double-Swiss
(C.04.5), and Swiss Team (C.04.6).

## Installation

```bash
npm install @echecs/swiss
```

## Quick Start

```typescript
import { pair } from '@echecs/swiss'; // Dutch system (default)
import type { Game, Player } from '@echecs/swiss';

const players: Player[] = [
  { id: 'alice', rating: 2100 },
  { id: 'bob', rating: 1950 },
  { id: 'carol', rating: 1870 },
  { id: 'dave', rating: 1820 },
];

// Pair round 1 (no games played yet)
const round1 = pair(players, []);
console.log(round1.pairings);
// [{ white: 'alice', black: 'carol' }, { white: 'bob', black: 'dave' }]

// Submit results — games[n] = round n+1, no `round` field on Game
const games: Game[][] = [
  [
    { white: 'alice', black: 'carol', result: 1 },
    { white: 'bob', black: 'dave', result: 0.5 },
  ],
];

// Pair round 2 — next round inferred from games.length + 1
const round2 = pair(players, games);
```

## API

### `pair(players, games)`

All pairing systems export a single `pair` function:

```typescript
pair(players: Player[], games: Game[][]): PairingResult;
```

- `players` — all registered players in the tournament
- `games` — completed games grouped by round: `games[0]` = round 1, `games[1]` =
  round 2, … The round to pair is `games.length + 1`

The `Game` type has no `round` field — round is encoded by array position.

Throws `RangeError` for fewer than 2 players or unknown player ids in games.

```typescript
interface PairingResult {
  byes: Bye[]; // players with no opponent this round
  pairings: Pairing[]; // white/black assignments
}

interface Pairing {
  black: string;
  white: string;
}

interface Bye {
  player: string;
}
```

### Subpath exports

Each pairing system is available at its own subpath:

```typescript
import { pair } from '@echecs/swiss'; // Dutch (default)
import { pair } from '@echecs/swiss/dutch'; // Dutch (explicit)
import { pair } from '@echecs/swiss/dubov'; // Dubov
import { pair } from '@echecs/swiss/burstein'; // Burstein
import { pair } from '@echecs/swiss/lim'; // Lim
import { pair } from '@echecs/swiss/double'; // Double-Swiss
import { pair } from '@echecs/swiss/team'; // Swiss Team
```

| Import path              | FIDE rule | Description                                                 |
| ------------------------ | --------- | ----------------------------------------------------------- |
| `@echecs/swiss`          | C.04.3    | Default import — Dutch system                               |
| `@echecs/swiss/dutch`    | C.04.3    | Top half vs bottom half within each score group             |
| `@echecs/swiss/dubov`    | C.04.4.1  | Adjacent pairing — rank 1 vs rank 2, rank 3 vs rank 4, etc. |
| `@echecs/swiss/burstein` | C.04.4.2  | Rank 1 vs rank last, rank 2 vs rank second-to-last, etc.    |
| `@echecs/swiss/lim`      | C.04.4.3  | Bi-directional pairing with strict colour rules             |
| `@echecs/swiss/double`   | C.04.5    | Two-game match Swiss                                        |
| `@echecs/swiss/team`     | C.04.6    | Team Swiss — teams as players, Type A colour preferences    |

### Double-Swiss matches

In Double-Swiss, each pairing is a two-game match. Both games appear in the same
round slot:

```typescript
import { pair } from '@echecs/swiss/double';

const round1 = pair(players, []);
// round1.pairings[0] = { white: 'alice', black: 'bob' }

// Record both games of the match in games[0] (round 1)
const games: Game[][] = [
  [
    { white: 'alice', black: 'bob', result: 1 }, // game 1
    { white: 'bob', black: 'alice', result: 0.5 }, // game 2
  ],
];
// Alice scored 1 + 0.5 = 1.5 points for this match
```

A Double-Swiss bye awards 1.5 points (one win + one draw), recorded as two
entries in the same round slot:

```typescript
const games: Game[][] = [
  [
    { white: 'carol', black: '', result: 1 },
    { white: 'carol', black: '', result: 0.5 },
  ],
];
```

### Byes

A bye is represented as a `Game` with `black: ''` (empty string). The player in
`white` receives the bye point:

```typescript
const games: Game[][] = [
  [
    { white: 'alice', black: 'carol', result: 1 },
    { white: 'bob', black: '', result: 1 }, // bye for bob
  ],
];
```

### Using with `@echecs/trf`

```typescript
import parse from '@echecs/trf';
import { pair } from '@echecs/swiss';
import type { Tournament } from '@echecs/trf';
import type { Game, Player } from '@echecs/swiss';

function toPlayers(t: Tournament): Player[] {
  return t.players.map((p) => ({
    id: String(p.pairingNumber),
    rating: p.rating,
  }));
}

function toGames(t: Tournament): Game[][] {
  const byRound: Game[][] = [];
  for (const player of t.players) {
    for (const r of player.results) {
      if (r.color !== 'w' || r.opponentId === null) continue;
      let result: 0 | 0.5 | 1;
      if (r.result === '1' || r.result === '+') result = 1;
      else if (r.result === '0' || r.result === '-') result = 0;
      else if (r.result === '=') result = 0.5;
      else continue;
      const idx = r.round - 1;
      byRound[idx] ??= [];
      byRound[idx].push({
        black: String(r.opponentId),
        result,
        white: String(player.pairingNumber),
      });
    }
  }
  return byRound;
}

const tournament = parse(trfString)!;
const pairings = pair(toPlayers(tournament), toGames(tournament));
```

## Types

```typescript
interface Player {
  id: string;
  rating?: number; // used for seeding in round 1
}

interface Game {
  black: string; // '' for a bye
  kind?: GameKind; // optional: classifies unplayed rounds
  result: Result; // from white's perspective
  white: string;
  // No `round` field — round is encoded by position in Game[][]
}

type GameKind =
  | 'forfeit-loss'
  | 'forfeit-win'
  | 'full-bye'
  | 'half-bye'
  | 'pairing-bye'
  | 'zero-bye';

type Result = 0 | 0.5 | 1;
```

## FIDE References

- [C.04.1 Basic rules](https://handbook.fide.com/chapter/C0401202507)
- [C.04.3 Dutch system](https://handbook.fide.com/chapter/C0403202602)
- [C.04.4.1 Dubov system](https://handbook.fide.com/chapter/C040401202602)
- [C.04.4.2 Burstein system](https://handbook.fide.com/chapter/C040402202602)
- [C.04.4.3 Lim system](https://handbook.fide.com/chapter/C040403202602)
- [C.04.5 Double-Swiss system](https://handbook.fide.com/chapter/DoubleSwissSystem202602)
- [C.04.6 Swiss Team system](https://handbook.fide.com/chapter/SwissTeamPairingSystem202602)

## License

MIT
