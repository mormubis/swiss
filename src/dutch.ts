import {
  byeScore,
  colorHistory,
  colorPreference,
  floatHistory,
  hasFaced,
  isTopscorer,
  score,
  unplayedRounds,
} from './utilities.js';

import type {
  FloatKind,
  Game,
  Pairing,
  PairingResult,
  Player,
} from './types.js';
import type { Color } from './utilities.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RankedPlayer {
  byeCount: number;
  colorDiff: number;
  colorHistory: Color[];
  floatHistory: FloatKind[];
  id: string;
  isTopscorer: boolean;
  preferenceStrength: 'absolute' | 'mild' | 'none' | 'strong';
  preferredColor: 'black' | 'none' | 'white';
  score: number;
  tpn: number;
  unplayedRounds: number;
}

interface BracketResult {
  downfloaters: RankedPlayer[];
  pairings: [RankedPlayer, RankedPlayer][];
}

// ---------------------------------------------------------------------------
// Color preference derivation
// ---------------------------------------------------------------------------

function derivePreference(
  fideColorDiff: number,
  history: Color[],
): {
  preferenceStrength: RankedPlayer['preferenceStrength'];
  preferredColor: RankedPlayer['preferredColor'];
} {
  const lastTwo = history.slice(-2);

  // Article 1.7.1 — absolute preference
  if (
    fideColorDiff < -1 ||
    (lastTwo.length === 2 && lastTwo[0] === 'black' && lastTwo[1] === 'black')
  ) {
    return { preferenceStrength: 'absolute', preferredColor: 'white' };
  }
  if (
    fideColorDiff > 1 ||
    (lastTwo.length === 2 && lastTwo[0] === 'white' && lastTwo[1] === 'white')
  ) {
    return { preferenceStrength: 'absolute', preferredColor: 'black' };
  }

  // Article 1.7.2 — strong preference
  if (fideColorDiff === -1) {
    return { preferenceStrength: 'strong', preferredColor: 'white' };
  }
  if (fideColorDiff === 1) {
    return { preferenceStrength: 'strong', preferredColor: 'black' };
  }

  // Article 1.7.3 — mild preference (alternate from last game)
  if (fideColorDiff === 0 && history.length > 0) {
    const last = history.at(-1);
    return {
      preferenceStrength: 'mild',
      preferredColor: last === 'white' ? 'black' : 'white',
    };
  }

  // Article 1.7.4 — no preference
  return { preferenceStrength: 'none', preferredColor: 'none' };
}

// ---------------------------------------------------------------------------
// Preprocessing
// ---------------------------------------------------------------------------

function buildRankedPlayers(
  players: Player[],
  games: Game[][],
): RankedPlayer[] {
  const totalRounds = games.length + 1;
  return players.map((player, index) => {
    // FIDE colorDiff = whites - blacks = -colorPreference()
    const fideColorDiff = -colorPreference(player.id, games);
    const history = colorHistory(player.id, games);
    const playerScore = score(player.id, games);
    const { preferenceStrength, preferredColor } = derivePreference(
      fideColorDiff,
      history,
    );

    return {
      byeCount: byeScore(player.id, games),
      colorDiff: fideColorDiff,
      colorHistory: history,
      floatHistory: floatHistory(player.id, games),
      id: player.id,
      isTopscorer: isTopscorer(playerScore, totalRounds),
      preferenceStrength,
      preferredColor,
      score: playerScore,
      tpn: index + 1,
      unplayedRounds: unplayedRounds(player.id, games),
    };
  });
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function sortByRank(players: RankedPlayer[]): RankedPlayer[] {
  return [...players].toSorted((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tpn - b.tpn;
  });
}

// ---------------------------------------------------------------------------
// Color allocation — FIDE Article 5
// ---------------------------------------------------------------------------

function allocateColor(higher: RankedPlayer, lower: RankedPlayer): Pairing {
  const strengthRank = (s: RankedPlayer['preferenceStrength']): number => {
    if (s === 'absolute') return 3;
    if (s === 'strong') return 2;
    if (s === 'mild') return 1;
    return 0;
  };

  // 5.2.1 — compatible preferences
  if (
    higher.preferredColor !== 'none' &&
    lower.preferredColor !== 'none' &&
    higher.preferredColor !== lower.preferredColor
  ) {
    return {
      black: higher.preferredColor === 'black' ? higher.id : lower.id,
      white: higher.preferredColor === 'white' ? higher.id : lower.id,
    };
  }

  if (higher.preferredColor !== 'none' && lower.preferredColor === 'none') {
    return {
      black: higher.preferredColor === 'black' ? higher.id : lower.id,
      white: higher.preferredColor === 'white' ? higher.id : lower.id,
    };
  }

  if (lower.preferredColor !== 'none' && higher.preferredColor === 'none') {
    return {
      black: lower.preferredColor === 'black' ? lower.id : higher.id,
      white: lower.preferredColor === 'white' ? lower.id : higher.id,
    };
  }

  // 5.2.2 — grant stronger preference
  const hStrength = strengthRank(higher.preferenceStrength);
  const lStrength = strengthRank(lower.preferenceStrength);

  if (hStrength !== lStrength) {
    const stronger = hStrength > lStrength ? higher : lower;
    const weaker = hStrength > lStrength ? lower : higher;
    if (stronger.preferredColor !== 'none') {
      return {
        black: stronger.preferredColor === 'black' ? stronger.id : weaker.id,
        white: stronger.preferredColor === 'white' ? stronger.id : weaker.id,
      };
    }
  }

  // both absolute — wider colorDiff wins
  if (
    higher.preferenceStrength === 'absolute' &&
    lower.preferenceStrength === 'absolute'
  ) {
    const hAbs = Math.abs(higher.colorDiff);
    const lAbs = Math.abs(lower.colorDiff);
    const wider = hAbs >= lAbs ? higher : lower;
    const narrower = hAbs >= lAbs ? lower : higher;
    if (wider.preferredColor !== 'none') {
      return {
        black: wider.preferredColor === 'black' ? wider.id : narrower.id,
        white: wider.preferredColor === 'white' ? wider.id : narrower.id,
      };
    }
  }

  // 5.2.3 — alternate from most recent diverging round
  const hHist = higher.colorHistory;
  const lHist = lower.colorHistory;
  const maxLength = Math.max(hHist.length, lHist.length);
  for (let index = maxLength - 1; index >= 0; index--) {
    const hc = hHist[index];
    const lc = lHist[index];
    if (hc !== undefined && lc !== undefined && hc !== lc) {
      return {
        black: hc === 'white' ? higher.id : lower.id,
        white: hc === 'black' ? higher.id : lower.id,
      };
    }
  }

  // 5.2.4 — higher-ranked player's preference
  if (higher.preferredColor === 'white')
    return { black: lower.id, white: higher.id };
  if (higher.preferredColor === 'black')
    return { black: higher.id, white: lower.id };

  // 5.2.5 — TPN parity
  if (higher.tpn % 2 === 1) return { black: lower.id, white: higher.id };
  return { black: higher.id, white: lower.id };
}

// ---------------------------------------------------------------------------
// Pair quality
// ---------------------------------------------------------------------------

function pairQuality(a: RankedPlayer, b: RankedPlayer): number {
  let q = 0;
  if (a.preferredColor !== 'none' && b.preferredColor !== 'none') {
    const aString =
      a.preferenceStrength === 'absolute'
        ? 3
        : a.preferenceStrength === 'strong'
          ? 2
          : 1;
    const bString =
      b.preferenceStrength === 'absolute'
        ? 3
        : b.preferenceStrength === 'strong'
          ? 2
          : 1;
    q +=
      a.preferredColor === b.preferredColor
        ? -(aString + bString)
        : aString + bString;
  }
  return q;
}

// ---------------------------------------------------------------------------
// Match constraint check
// ---------------------------------------------------------------------------

function isValidPair(
  a: RankedPlayer,
  b: RankedPlayer,
  games: Game[][],
  relaxC3: boolean,
): boolean {
  if (hasFaced(a.id, b.id, games)) return false;
  if (
    !relaxC3 &&
    !a.isTopscorer &&
    !b.isTopscorer &&
    a.preferenceStrength === 'absolute' &&
    b.preferenceStrength === 'absolute' &&
    a.preferredColor === b.preferredColor
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// S1 vs S2 backtracking
// ---------------------------------------------------------------------------

function runS1S2Backtrack(
  s1: RankedPlayer[],
  s2: RankedPlayer[],
  games: Game[][],
  relaxC3: boolean,
): BracketResult | undefined {
  const pairings: [RankedPlayer, RankedPlayer][] = [];
  const usedS2 = new Set<number>();

  function backtrack(s1Index: number): boolean {
    if (s1Index >= s1.length) return true;
    const p1 = s1[s1Index];
    if (p1 === undefined) return true;
    const partners: { idx: number; quality: number }[] = [];
    for (const [index, element] of s2.entries()) {
      if (usedS2.has(index) || element === undefined) continue;
      if (isValidPair(p1, element, games, relaxC3)) {
        partners.push({ idx: index, quality: pairQuality(p1, element) });
      }
    }
    partners.sort((a, b) =>
      b.quality === a.quality ? a.idx - b.idx : b.quality - a.quality,
    );
    for (const { idx } of partners) {
      const partner = s2[idx];
      if (partner === undefined) continue;
      usedS2.add(idx);
      pairings.push([p1, partner]);
      if (backtrack(s1Index + 1)) return true;
      usedS2.delete(idx);
      pairings.pop();
    }
    return false;
  }

  if (backtrack(0)) {
    return {
      downfloaters: s2.filter((_, index) => !usedS2.has(index)),
      pairings,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// General pool backtracking (all-vs-all, even count required)
// ---------------------------------------------------------------------------

function runEvenBacktrack(
  sorted: RankedPlayer[],
  games: Game[][],
  relaxC3: boolean,
): [RankedPlayer, RankedPlayer][] | undefined {
  if (sorted.length === 0) return [];
  if (sorted.length % 2 !== 0) return undefined;

  const pairings: [RankedPlayer, RankedPlayer][] = [];
  const paired = new Set<number>();

  function backtrack(index: number): boolean {
    while (index < sorted.length && paired.has(index)) index++;
    if (index >= sorted.length) return true;

    const p1 = sorted[index];
    if (p1 === undefined) return true;

    const partners: { idx: number; quality: number }[] = [];
    for (let index_ = index + 1; index_ < sorted.length; index_++) {
      if (paired.has(index_)) continue;
      const p2 = sorted[index_];
      if (p2 === undefined) continue;
      if (isValidPair(p1, p2, games, relaxC3)) {
        partners.push({ idx: index_, quality: pairQuality(p1, p2) });
      }
    }
    partners.sort((a, b) =>
      b.quality === a.quality ? a.idx - b.idx : b.quality - a.quality,
    );

    for (const { idx } of partners) {
      const partner = sorted[idx];
      if (partner === undefined) continue;
      paired.add(index);
      paired.add(idx);
      pairings.push([p1, partner]);
      if (backtrack(index + 1)) return true;
      paired.delete(index);
      paired.delete(idx);
      pairings.pop();
    }
    return false;
  }

  if (backtrack(0)) return pairings;
  return undefined;
}

// ---------------------------------------------------------------------------
// Bracket pairing
// ---------------------------------------------------------------------------

function pairHomogeneous(
  players: RankedPlayer[],
  games: Game[][],
): BracketResult | undefined {
  if (players.length === 0) return { downfloaters: [], pairings: [] };
  const first = players[0];
  if (players.length === 1 && first !== undefined) {
    return { downfloaters: [first], pairings: [] };
  }

  const sorted = sortByRank(players);
  const half = Math.floor(sorted.length / 2);
  const s1 = sorted.slice(0, half);
  const s2 = sorted.slice(half);

  for (const relaxC3 of [false, true]) {
    const result = runS1S2Backtrack(s1, s2, games, relaxC3);
    if (result !== undefined) return result;
  }

  // Fall back to general matching (any-vs-any)
  for (const relaxC3 of [false, true]) {
    if (sorted.length % 2 === 0) {
      const result = runEvenBacktrack(sorted, games, relaxC3);
      if (result !== undefined) return { downfloaters: [], pairings: result };
    } else {
      // Odd: try each player as downfloater (lowest rank first)
      for (let skipIndex = sorted.length - 1; skipIndex >= 0; skipIndex--) {
        const skipPlayer = sorted[skipIndex];
        if (skipPlayer === undefined) continue;
        const pool = sorted.filter((_, index) => index !== skipIndex);
        const result = runEvenBacktrack(pool, games, relaxC3);
        if (result !== undefined) {
          return { downfloaters: [skipPlayer], pairings: result };
        }
      }
    }
  }

  return undefined;
}

function pairHeterogeneous(
  mdps: RankedPlayer[],
  residents: RankedPlayer[],
  games: Game[][],
): BracketResult | undefined {
  if (mdps.length === 0) return pairHomogeneous(residents, games);

  for (const relaxC3 of [false, true]) {
    const result = runS1S2Backtrack(mdps, residents, games, relaxC3);
    if (result !== undefined) {
      if (result.downfloaters.length === 0) return result;
      const remaining = pairHomogeneous(result.downfloaters, games);
      if (remaining === undefined) continue;
      return {
        downfloaters: remaining.downfloaters,
        pairings: [...result.pairings, ...remaining.pairings],
      };
    }
  }

  // Fall back to all-vs-all for the combined pool
  return pairHomogeneous([...mdps, ...residents], games);
}

function pairBracket(
  residents: RankedPlayer[],
  downfloaters: RankedPlayer[],
  games: Game[][],
): BracketResult | undefined {
  if (downfloaters.length > 0) {
    return pairHeterogeneous(downfloaters, residents, games);
  }
  return pairHomogeneous(residents, games);
}

// ---------------------------------------------------------------------------
// PAB assignment
// ---------------------------------------------------------------------------

function assignPAB(players: RankedPlayer[]): RankedPlayer | undefined {
  if (players.length === 0) return undefined;
  const noBye = players.filter((p) => p.byeCount === 0);
  const pool = noBye.length > 0 ? noBye : players;
  return sortByRank(pool).at(-1);
}

// ---------------------------------------------------------------------------
// Bracket-by-bracket pass, returns pairings or undefined if globally stuck
// ---------------------------------------------------------------------------

function tryBracketPass(
  toBePaired: RankedPlayer[],
  games: Game[][],
): [RankedPlayer, RankedPlayer][] | undefined {
  const scoreGroupMap = new Map<number, RankedPlayer[]>();
  for (const player of toBePaired) {
    const group = scoreGroupMap.get(player.score) ?? [];
    group.push(player);
    scoreGroupMap.set(player.score, group);
  }

  const scoreGroups = [...scoreGroupMap.entries()]
    .toSorted((a, b) => b[0] - a[0])
    .map(([, group]) => group);

  const allPairings: [RankedPlayer, RankedPlayer][] = [];
  let downfloatersFromAbove: RankedPlayer[] = [];

  for (
    let bracketIndex = 0;
    bracketIndex < scoreGroups.length;
    bracketIndex++
  ) {
    const residents = scoreGroups[bracketIndex];
    if (residents === undefined) continue;
    const isLastBracket = bracketIndex === scoreGroups.length - 1;

    const result = pairBracket(residents, downfloatersFromAbove, games);
    if (result === undefined) {
      downfloatersFromAbove = [...downfloatersFromAbove, ...residents];
    } else {
      allPairings.push(...result.pairings);
      downfloatersFromAbove = result.downfloaters;
    }

    if (isLastBracket && downfloatersFromAbove.length > 0) {
      // Force-pair remaining with general even backtracker
      const remaining = sortByRank(downfloatersFromAbove);
      if (remaining.length % 2 !== 0) return undefined;

      for (const relaxC3 of [false, true]) {
        const forced = runEvenBacktrack(remaining, games, relaxC3);
        if (forced !== undefined) {
          allPairings.push(...forced);
          return allPairings;
        }
      }
      return undefined;
    }
  }

  return allPairings;
}

// ---------------------------------------------------------------------------
// Main pair function
// ---------------------------------------------------------------------------

function pair(players: Player[], games: Game[][]): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const ranked = sortByRank(buildRankedPlayers(players, games));
  const needsBye = ranked.length % 2 === 1;

  // Build ordered bye candidates (preferred first)
  const byeCandidates: (RankedPlayer | undefined)[] = needsBye
    ? (() => {
        const preferred = assignPAB(ranked);
        const others = ranked.filter((p) => p.id !== preferred?.id);
        return preferred === undefined ? [...ranked] : [preferred, ...others];
      })()
    : [undefined];

  for (const byeCandidate of byeCandidates) {
    const toBePaired =
      byeCandidate === undefined
        ? ranked
        : ranked.filter((p) => p.id !== byeCandidate.id);

    // First attempt: bracket-by-bracket
    const bracketResult = tryBracketPass(toBePaired, games);
    if (bracketResult !== undefined) {
      return {
        byes: byeCandidate === undefined ? [] : [{ player: byeCandidate.id }],
        pairings: bracketResult.map(([higher, lower]) =>
          allocateColor(higher, lower),
        ),
      };
    }

    // Second attempt: global matching (ignore score group structure)
    for (const relaxC3 of [false, true]) {
      const globalResult = runEvenBacktrack(toBePaired, games, relaxC3);
      if (globalResult !== undefined) {
        return {
          byes: byeCandidate === undefined ? [] : [{ player: byeCandidate.id }],
          pairings: globalResult.map(([higher, lower]) =>
            allocateColor(higher, lower),
          ),
        };
      }
    }
  }

  // Absolute fallback: greedy no-rematch
  const byePlayer = needsBye ? assignPAB(ranked) : undefined;
  const fallbackBye = byePlayer ?? (needsBye ? ranked.at(-1) : undefined);
  const toBePaired =
    fallbackBye === undefined
      ? ranked
      : ranked.filter((p) => p.id !== fallbackBye.id);
  const pairings: Pairing[] = [];
  const used = new Set<string>();
  const sorted = sortByRank(toBePaired);
  for (let index = 0; index < sorted.length; index++) {
    const p1 = sorted[index];
    if (p1 === undefined || used.has(p1.id)) continue;
    for (let index_ = index + 1; index_ < sorted.length; index_++) {
      const p2 = sorted[index_];
      if (p2 === undefined || used.has(p2.id)) continue;
      if (hasFaced(p1.id, p2.id, games)) continue;
      pairings.push(allocateColor(p1, p2));
      used.add(p1.id);
      used.add(p2.id);
      break;
    }
  }

  return {
    byes: fallbackBye === undefined ? [] : [{ player: fallbackBye.id }],
    pairings,
  };
}

export { pair };
