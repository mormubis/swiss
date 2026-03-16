/**
 * Minimal TRF (Tournament Report File) parser for use in tests.
 *
 * Parses the subset of TRF used by bbpPairings test fixtures into the
 * Player[] and Game[] types used by @echecs/swiss.
 *
 * TRF reference: https://www.rrweb.org/javafo/aum/JaVaFo2_AUM.htm
 * License of test fixtures: Apache 2.0 (bbpPairings)
 *
 * Column layout of a `001` player line (0-indexed):
 *   0–2   record type ("001")
 *   4–7   starting rank / pairing number
 *   9     sex
 *   10–13 FIDE title
 *   15–46 player name
 *   48–52 FIDE rating
 *   53–55 federation
 *   57–68 FIDE player ID
 *   70–79 date of birth
 *   80–83 points
 *   84–88 rank
 *   91+   round results, 10 characters each:
 *           "   O c r  " where O = opponent id (right-justified), c = color, r = result
 *
 * Result codes:
 *   1  = win
 *   0  = loss
 *   =  = draw
 *   +  = forfeit win
 *   -  = forfeit loss
 *   Z  = zero-point bye (player absent, not to be paired)
 *   F  = full-point bye
 *   U  = unplayed (not yet paired)
 */

import type { Game, Player, Result } from '../types.js';

interface TrfFixture {
  /** Completed games from all rounds that have been played. */
  games: Game[];
  /** All registered players. */
  players: Player[];
  /**
   * Players who already have a pre-assigned result for the target round
   * (Z-bye, F-bye, or pre-assigned game) and must be excluded from pairing.
   */
  preAssigned: Set<string>;
}

const ROUND_ENTRY_LENGTH = 10;
const ROUND_RESULTS_OFFSET = 91;

/** Result codes that mean "player is absent / pre-assigned for this round" */
const PRE_ASSIGNED_CODES = new Set(['Z', 'F']);

/** Result codes that mean "game not yet played, exclude from history" */
const UNPLAYED_CODES = new Set(['U']);

function parseTrf(content: string, targetRound?: number): TrfFixture {
  const players: Player[] = [];
  const games: Game[] = [];
  const preAssigned = new Set<string>();

  // Determine target round from XXR if not provided
  let roundCount = targetRound;
  if (roundCount === undefined) {
    const xxrMatch = /^XXR\s+(\d+)/m.exec(content);
    if (xxrMatch?.[1] !== undefined) {
      roundCount = Number(xxrMatch[1]);
    }
  }

  for (const line of content.split('\n')) {
    if (!line.startsWith('001')) {
      continue;
    }

    const id = line.slice(4, 8).trim();
    const ratingString = line.slice(48, 52).trim();
    const rating = ratingString.length === 0 ? undefined : Number(ratingString);

    players.push({ id, rating });

    const resultsSection = line.slice(ROUND_RESULTS_OFFSET);

    for (
      let index = 0;
      index < resultsSection.length;
      index += ROUND_ENTRY_LENGTH
    ) {
      const entry = resultsSection
        .slice(index, index + ROUND_ENTRY_LENGTH)
        .trim();
      if (entry.length === 0) {
        continue;
      }

      const parts = entry.split(/\s+/);
      const opponentId = parts[0];
      const color = parts[1];
      const resultChar = parts[2];

      if (
        opponentId === undefined ||
        color === undefined ||
        resultChar === undefined
      ) {
        continue;
      }

      const round = Math.floor(index / ROUND_ENTRY_LENGTH) + 1;

      // Pre-assigned result for the target round — player should be excluded
      if (roundCount !== undefined && round === roundCount) {
        if (PRE_ASSIGNED_CODES.has(resultChar)) {
          preAssigned.add(id);
        }
        continue;
      }

      // Skip byes and unplayed entries from completed rounds
      if (
        opponentId === '0000' ||
        UNPLAYED_CODES.has(resultChar) ||
        PRE_ASSIGNED_CODES.has(resultChar)
      ) {
        continue;
      }

      // Only record games where this player is white to avoid duplicates
      if (color !== 'w') {
        continue;
      }

      let result: Result;
      switch (resultChar) {
        case '1':
        case '+': {
          result = 1;
          break;
        }
        case '0':
        case '-': {
          result = 0;
          break;
        }
        case '=': {
          result = 0.5;
          break;
        }
        default: {
          continue;
        }
      }

      games.push({
        blackId: opponentId,
        result,
        round,
        whiteId: id,
      });
    }
  }

  return { games, players, preAssigned };
}

export { parseTrf };
export type { TrfFixture };
