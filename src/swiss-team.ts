import {
  assignLexicographicBye,
  pairAllBrackets,
  rankByScoreThenTPN,
} from './lexicographic.js';
import { matchColorHistory, typeAColorPreference } from './utilities.js';

import type { Game, PairingResult, Player } from './types.js';

/**
 * Allocates colors for a Swiss Team pairing per FIDE C.04.6 Article 4.
 *
 * Determines the "first-team":
 *   - Higher score wins.
 *   - Tie broken by smaller TPN (smaller original array index).
 *
 * Then applies rules 4.3.1 through 4.3.9 in descending priority.
 */
function allocateTeamColors(
  a: Player,
  b: Player,
  players: Player[],
  games: Game[][],
): { blackId: string; whiteId: string } {
  // Compute scores for a and b.
  let scoreA = 0;
  let scoreB = 0;
  for (const g of games.flat()) {
    if (g.whiteId === a.id) {
      scoreA += g.result;
    } else if (g.blackId === a.id) {
      scoreA += 1 - g.result;
    }
    if (g.whiteId === b.id) {
      scoreB += g.result;
    } else if (g.blackId === b.id) {
      scoreB += 1 - g.result;
    }
  }

  // Determine first-team: higher score wins; ties broken by smaller TPN.
  const tpnA = players.indexOf(a);
  const tpnB = players.indexOf(b);
  const firstIsA = scoreA > scoreB || (scoreA === scoreB && tpnA < tpnB);
  const [first, other] = firstIsA ? [a, b] : [b, a];
  const firstTpn = players.indexOf(first); // 0-based TPN

  const firstHistory = matchColorHistory(first.id, games);
  const otherHistory = matchColorHistory(other.id, games);

  // Helper: give first-team White.
  const firstWhite = (): { blackId: string; whiteId: string } => ({
    blackId: other.id,
    whiteId: first.id,
  });
  // Helper: give first-team Black.
  const firstBlack = (): { blackId: string; whiteId: string } => ({
    blackId: first.id,
    whiteId: other.id,
  });

  // 4.3.1 — Both have zero match history.
  if (firstHistory.length === 0 && otherHistory.length === 0) {
    // First-team with odd 1-based TPN gets initial color (White).
    // First-team with even 1-based TPN gets opposite (Black).
    const firstTpn1Based = firstTpn + 1;
    return firstTpn1Based % 2 === 1 ? firstWhite() : firstBlack();
  }

  // 4.3.2 — Only one team has a Type A color preference → grant it.
  const firstPref = typeAColorPreference(first.id, games);
  const otherPref = typeAColorPreference(other.id, games);

  if (firstPref !== undefined && otherPref === undefined) {
    return firstPref === 'white' ? firstWhite() : firstBlack();
  }
  if (firstPref === undefined && otherPref !== undefined) {
    // Grant other team's preference.
    return otherPref === 'white' ? firstBlack() : firstWhite();
  }

  // 4.3.3 — Both teams have opposite preferences → grant both.
  if (
    firstPref !== undefined &&
    otherPref !== undefined &&
    firstPref !== otherPref
  ) {
    // They have opposite preferences: grant each their preference.
    return firstPref === 'white' ? firstWhite() : firstBlack();
  }

  // 4.3.4 — (Type B only, skip for v1)

  // 4.3.5 — Lower color difference gets White.
  // CD = whites - blacks from match color history.
  const cdFirst =
    firstHistory.filter((c) => c === 'white').length -
    firstHistory.filter((c) => c === 'black').length;
  const cdOther =
    otherHistory.filter((c) => c === 'white').length -
    otherHistory.filter((c) => c === 'black').length;

  if (cdFirst !== cdOther) {
    // Lower CD gets White (more negative → more black history → wants White).
    return cdFirst < cdOther ? firstWhite() : firstBlack();
  }

  // 4.3.6 — Alternate from most recent time one had White and other Black.
  const minLength = Math.min(firstHistory.length, otherHistory.length);
  for (let index = minLength - 1; index >= 0; index--) {
    const firstColor = firstHistory[index];
    const otherColor = otherHistory[index];
    if (
      firstColor !== undefined &&
      otherColor !== undefined &&
      firstColor !== otherColor
    ) {
      // Alternate from that divergence: if first had White, first gets Black now.
      return firstColor === 'white' ? firstBlack() : firstWhite();
    }
  }

  // 4.3.7 — Grant first-team's preference (Type A only).
  if (firstPref !== undefined) {
    return firstPref === 'white' ? firstWhite() : firstBlack();
  }

  // 4.3.8 — Alternate first-team's color from last round.
  const firstLast = firstHistory.at(-1);
  if (firstLast !== undefined) {
    return firstLast === 'white' ? firstBlack() : firstWhite();
  }

  // 4.3.9 — Alternate other team's color from last round.
  const otherLast = otherHistory.at(-1);
  if (otherLast !== undefined) {
    return otherLast === 'white' ? firstWhite() : firstBlack();
  }

  // Fallback: first-team gets White.
  return firstWhite();
}

/**
 * Swiss Team pairing (FIDE C.04.6).
 * Each round is a single match between teams.
 */
function pair(players: Player[], games: Game[][]): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const ranked = rankByScoreThenTPN(players, games);
  const byePlayer = assignLexicographicBye(players, ranked, games);

  const toBePaired = ranked.filter((p) => p.id !== byePlayer?.id);
  const pairings = pairAllBrackets(
    toBePaired,
    players,
    games,
    allocateTeamColors,
  );

  return {
    byes: byePlayer === undefined ? [] : [{ playerId: byePlayer.id }],
    pairings,
  };
}

export { pair };
