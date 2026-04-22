/**
 * RTG comparison: generate N random tournaments with bbpPairings RTG,
 * then for each round, compare our pairing against what bbpPairings stored.
 */
import { parse } from '@echecs/trf';
import { execSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';


import { pair } from '../src/dutch.js';

import type { Game, GameKind, Player } from '../src/types.js';

const BBP = '/tmp/bbpPairings/build/bbpPairings.exe';
const N = Number(process.argv[2]) || 50;

interface TournamentData {
  games: Game[][];
  players: Player[];
  totalRounds: number;
}

function trfToSwiss(raw: string): TournamentData | undefined {
  const tournament = parse(raw);
  if (!tournament) return undefined;

  const players: Player[] = tournament.players.map((p) => ({
    id: String(p.pairingNumber),
    rating: p.rating,
  }));

  let maxRound = 0;
  for (const player of tournament.players) {
    for (const result of player.results) {
      if (result.round > maxRound) maxRound = result.round;
    }
  }

  const roundArrays: Game[][] = Array.from({ length: maxRound }, () => []);
  for (const player of tournament.players) {
    for (const result of player.results) {
      const ri = result.round - 1;
      if (!roundArrays[ri]) continue;
      if (result.opponentId === undefined) {
        const byeMap: Record<string, { kind: GameKind; result: 0 | 0.5 | 1 }> =
          {
            F: { kind: 'full-bye', result: 1 },
            H: { kind: 'half-bye', result: 0.5 },
            U: { kind: 'pairing-bye', result: 1 },
            Z: { kind: 'zero-bye', result: 0 },
          };
        const bye = byeMap[result.result];
        if (bye)
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          roundArrays[ri]!.push({
            black: '',
            kind: bye.kind,
            result: bye.result,
            white: String(player.pairingNumber),
          });
        continue;
      }
      if (result.color !== 'w') continue;
      let score: 0 | 0.5 | 1;
      switch (result.result) {
        case '1':
        case '+': {
          score = 1;
          break;
        }
        case '0':
        case '-': {
          score = 0;
          break;
        }
        case '=': {
          score = 0.5;
          break;
        }
        default: {
          continue;
        }
      }
      const game: Game = {
        black: String(result.opponentId),
        result: score,
        white: String(player.pairingNumber),
      };
      if (result.result === '+') game.kind = 'forfeit-win';
      else if (result.result === '-') game.kind = 'forfeit-loss';
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      roundArrays[ri]!.push(game);
    }
  }

  return { games: roundArrays, players, totalRounds: maxRound };
}

/**
 * Extract pairings for round `round` from the TRF data.
 * Returns [white, black] pairs (excluding byes).
 */
function extractRoundPairings(raw: string, round: number): [string, string][] {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const tournament = parse(raw)!;
  const pairs: [string, string][] = [];
  const seen = new Set<string>();

  for (const player of tournament.players) {
    const result = player.results.find((r) => r.round === round);
    if (!result || result.opponentId === undefined) continue;

    const key = [String(player.pairingNumber), String(result.opponentId)]
      .toSorted()
      .join('-');
    if (seen.has(key)) continue;
    seen.add(key);

    if (result.color === 'w') {
      pairs.push([String(player.pairingNumber), String(result.opponentId)]);
    } else {
      pairs.push([String(result.opponentId), String(player.pairingNumber)]);
    }
  }

  return pairs;
}

// --- Main ---
let totalTournaments = 0;
let totalRoundsTested = 0;
let totalPerfectRounds = 0;
let totalPairings = 0;
let totalMatching = 0;
let crashes = 0;
const failures: {
  matching: number;
  round: number;
  seed: number;
  total: number;
}[] = [];

for (let seed = 1; seed <= N; seed++) {
  const trfPath = `/tmp/rtg_seed_${seed}.trf`;

  // Generate
  try {
    execSync(`${BBP} --dutch -g -o "${trfPath}" -s ${seed} 2>/dev/null`, {
      timeout: 30_000,
    });
  } catch {
    process.stdout.write(`seed ${seed}: RTG generation failed\n`);
    crashes++;
    continue;
  }

  const raw = readFileSync(trfPath, 'utf8').replaceAll(/\r\n?/g, '\n');
  const data = trfToSwiss(raw);
  if (!data) {
    process.stdout.write(`seed ${seed}: TRF parse failed\n`);
    crashes++;
    try {
      unlinkSync(trfPath);
    } catch {
      // ignore cleanup errors
    }
    continue;
  }

  totalTournaments++;
  let seedPerfect = true;

  // For each round, compare our pairing against what's stored in the TRF
  for (let round = 1; round <= data.totalRounds; round++) {
    const priorGames = data.games.slice(0, round - 1);
    const expectedPairs = extractRoundPairings(raw, round);
    if (expectedPairs.length === 0) continue;

    let result;
    try {
      result = pair(data.players, priorGames);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`seed ${seed} round ${round}: CRASH — ${message}\n`);
      crashes++;
      seedPerfect = false;
      break;
    }

    const expectedSet = new Set(
      expectedPairs.map(([w, b]) => [w, b].toSorted().join('-')),
    );
    const actualSet = new Set(
      result.pairings.map((p) => [p.white, p.black].toSorted().join('-')),
    );

    const missing = [...expectedSet].filter((x) => !actualSet.has(x));
    const matching = expectedSet.size - missing.length;
    const total = expectedSet.size;

    totalRoundsTested++;
    totalPairings += total;
    totalMatching += matching;

    if (matching === total) {
      totalPerfectRounds++;
    } else {
      seedPerfect = false;
      failures.push({ matching, round, seed, total });
      if (failures.length <= 20) {
        process.stdout.write(
          `seed ${seed} round ${round}: ${matching}/${total} (${((matching / total) * 100).toFixed(0)}%) — ${data.players.length} players\n`,
        );
      }
    }
  }

  if (seedPerfect) {
    process.stdout.write(
      `seed ${seed}: all ${data.totalRounds} rounds perfect\n`,
    );
  }

  try {
    unlinkSync(trfPath);
  } catch {
    // ignore cleanup errors
  }
}

process.stdout.write(`\n=== RTG Comparison: ${N} tournaments ===\n`);
process.stdout.write(
  `tournaments: ${totalTournaments} (${crashes} generation failures)\n`,
);
process.stdout.write(
  `rounds: ${totalPerfectRounds}/${totalRoundsTested} perfect\n`,
);
process.stdout.write(
  `pairings: ${totalMatching}/${totalPairings} (${((totalMatching / totalPairings) * 100).toFixed(1)}%)\n`,
);
if (failures.length > 0) {
  process.stdout.write(`\nfirst ${Math.min(failures.length, 20)} failures:\n`);
  for (const f of failures.slice(0, 20)) {
    process.stdout.write(
      `  seed ${f.seed} round ${f.round}: ${f.matching}/${f.total}\n`,
    );
  }
  if (failures.length > 20) {
    process.stdout.write(`  ... and ${failures.length - 20} more\n`);
  }
}
