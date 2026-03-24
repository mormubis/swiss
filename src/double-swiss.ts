import {
  assignLexicographicBye,
  pairAllBrackets,
  rankByScoreThenTPN,
} from './lexicographic.js';
import { matchColorHistory } from './utilities.js';

import type { Game, PairingResult, Player } from './types.js';

/**
 * Allocates colors for a Double-Swiss pairing per FIDE C.04.5 Article 4.
 *
 * Determines the Higher-Ranked Player (HRP):
 *   - HRP = player with higher score.
 *   - If scores equal, HRP = player with smaller TPN (smaller index in `players`).
 *
 * Then applies rules 4.3.1 through 4.3.5 in descending priority.
 */
function allocateDoubleColors(
  a: Player,
  b: Player,
  players: Player[],
  games: Game[][],
): { black: string; white: string } {
  // Compute scores for a and b.
  let scoreA = 0;
  let scoreB = 0;
  for (const g of games.flat()) {
    if (g.white === a.id) {
      scoreA += g.result;
    } else if (g.black === a.id) {
      scoreA += 1 - g.result;
    }
    if (g.white === b.id) {
      scoreB += g.result;
    } else if (g.black === b.id) {
      scoreB += 1 - g.result;
    }
  }

  // Determine HRP: higher score wins; ties broken by smaller TPN (original array index).
  const tpnA = players.indexOf(a);
  const tpnB = players.indexOf(b);
  const hrpIsA = scoreA > scoreB || (scoreA === scoreB && tpnA < tpnB);
  const [hrp, opp] = hrpIsA ? [a, b] : [b, a];
  const hrpTpn = players.indexOf(hrp); // 0-based TPN

  const hrpHistory = matchColorHistory(hrp.id, games);
  const oppHistory = matchColorHistory(opp.id, games);

  // Helper: give HRP white.
  const hrpWhite = (): { black: string; white: string } => ({
    black: opp.id,
    white: hrp.id,
  });
  // Helper: give HRP black.
  const hrpBlack = (): { black: string; white: string } => ({
    black: hrp.id,
    white: opp.id,
  });

  // 4.3.1 — Both have zero match history.
  if (hrpHistory.length === 0 && oppHistory.length === 0) {
    // HRP has odd 1-based TPN → give HRP initial color (White).
    // HRP has even 1-based TPN → give HRP opposite (Black).
    const hrpTpn1Based = hrpTpn + 1;
    return hrpTpn1Based % 2 === 1 ? hrpWhite() : hrpBlack();
  }

  // 4.3.2 — Fewer Whites.
  const hrpWhites = hrpHistory.filter((c) => c === 'white').length;
  const oppWhites = oppHistory.filter((c) => c === 'white').length;
  if (hrpWhites !== oppWhites) {
    // Player with fewer whites gets White.
    return hrpWhites < oppWhites ? hrpWhite() : hrpBlack();
  }

  // 4.3.3 — Alternate from most recent divergence.
  // Walk back through both histories to find most recent round where colors differed.
  const minLength = Math.min(hrpHistory.length, oppHistory.length);
  for (let index = minLength - 1; index >= 0; index--) {
    const hrpColor = hrpHistory[index];
    const oppColor = oppHistory[index];
    if (
      hrpColor !== undefined &&
      oppColor !== undefined &&
      hrpColor !== oppColor
    ) {
      // Found divergence: alternate from that round.
      // If HRP had White in that round, HRP gets Black now (and vice versa).
      return hrpColor === 'white' ? hrpBlack() : hrpWhite();
    }
  }

  // 4.3.4 — Alternate HRP's color from most recent match.
  const hrpLast = hrpHistory.at(-1);
  if (hrpLast !== undefined) {
    return hrpLast === 'white' ? hrpBlack() : hrpWhite();
  }

  // 4.3.5 — Alternate opponent's color from most recent match.
  const oppLast = oppHistory.at(-1);
  if (oppLast !== undefined) {
    // Alternate opp's color: if opp had white → opp gets black (HRP gets white).
    return oppLast === 'white' ? hrpWhite() : hrpBlack();
  }

  // Fallback: HRP gets White.
  return hrpWhite();
}

/**
 * Double-Swiss pairing (FIDE C.04.5).
 * Each round is a two-game match between the same opponents.
 * PAB (bye) awards 1.5 points.
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
    allocateDoubleColors,
  );

  return {
    byes: byePlayer === undefined ? [] : [{ player: byePlayer.id }],
    pairings,
  };
}

export { pair };
