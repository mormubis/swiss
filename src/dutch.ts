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
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum bracket size for which we attempt full FIDE transposition/exchange
 * enumeration. Larger brackets use a greedy fallback to avoid combinatorial
 * explosion (e.g. C(90,90) transpositions for 180-player homogeneous bracket).
 *
 * For a bracket of size N, S1 has floor(N/2) players and S2 has ceil(N/2).
 * Transpositions = C(ceil(N/2), floor(N/2)).
 * Exchanges for k=1: floor(N/2) * ceil(N/2) combos.
 * We keep this small to avoid timeout.
 */
const FIDE_EXACT_LIMIT = 10;

// ---------------------------------------------------------------------------
// Match constraint check (C1: no rematch, C3: no absolute color clash)
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
// Candidate type
// ---------------------------------------------------------------------------

interface Candidate {
  downfloaters: RankedPlayer[];
  pairings: [RankedPlayer, RankedPlayer][];
}

// ---------------------------------------------------------------------------
// Candidate evaluation — returns cost tuple or undefined if C1/C3 violated
// ---------------------------------------------------------------------------

function evaluateCandidate(
  candidate: Candidate,
  games: Game[][],
  playerMap: Map<string, RankedPlayer>,
  totalRounds: number,
  bracketIsLast: boolean,
): number[] | undefined {
  // Check C1 (no rematch) and C3 (absolute color clash) on each pairing
  for (const [a, b] of candidate.pairings) {
    if (!isValidPair(a, b, games, false)) return undefined;
  }

  const { downfloaters, pairings } = candidate;

  // C5: PAB assignee score (only when bracketIsLast and exactly 1 downfloater)
  let c5 = 0;
  if (bracketIsLast && downfloaters.length === 1) {
    const pab = downfloaters[0];
    if (pab !== undefined) {
      c5 = pab.score;
    }
  }

  // C6: number of downfloaters (minimize)
  const c6 = downfloaters.length;

  // C7: weighted sum of downfloater scores
  let c7 = 0;
  const sortedDownfloaters = downfloaters.toSorted((a, b) => b.score - a.score);
  for (const [index, df] of sortedDownfloaters.entries()) {
    c7 += df.score * Math.pow(2, sortedDownfloaters.length - 1 - index);
  }

  // C9: PAB assignee unplayed rounds
  let c9 = 0;
  if (bracketIsLast && downfloaters.length === 1) {
    const pab = downfloaters[0];
    if (pab !== undefined) {
      c9 = pab.unplayedRounds;
    }
  }

  // Project color assignments and compute colorDiff after this round
  const colorDiffAfter = new Map<string, number>();
  for (const [id, p] of playerMap) {
    colorDiffAfter.set(id, p.colorDiff);
  }

  const projectedPairings: { black: string; white: string }[] = [];
  for (const [a, b] of pairings) {
    const proj = allocateColor(a, b);
    projectedPairings.push(proj);
    colorDiffAfter.set(proj.white, (colorDiffAfter.get(proj.white) ?? 0) + 1);
    colorDiffAfter.set(proj.black, (colorDiffAfter.get(proj.black) ?? 0) - 1);
  }

  // C10: topscorers getting |colorDiff| > 2
  let c10 = 0;
  for (const proj of projectedPairings) {
    const wDiff = colorDiffAfter.get(proj.white) ?? 0;
    const bDiff = colorDiffAfter.get(proj.black) ?? 0;
    if (playerMap.get(proj.white)?.isTopscorer && Math.abs(wDiff) > 2) c10++;
    if (playerMap.get(proj.black)?.isTopscorer && Math.abs(bDiff) > 2) c10++;
  }

  // C11: topscorers getting same color 3x in a row
  let c11 = 0;
  for (const proj of projectedPairings) {
    const wPlayer = playerMap.get(proj.white);
    const bPlayer = playerMap.get(proj.black);
    if (wPlayer?.isTopscorer) {
      const wHist = wPlayer.colorHistory.slice(-2);
      if (wHist.length === 2 && wHist[0] === 'white' && wHist[1] === 'white')
        c11++;
    }
    if (bPlayer?.isTopscorer) {
      const bHist = bPlayer.colorHistory.slice(-2);
      if (bHist.length === 2 && bHist[0] === 'black' && bHist[1] === 'black')
        c11++;
    }
  }

  // C12: players not getting color preference
  let c12 = 0;
  for (const proj of projectedPairings) {
    const wPlayer = playerMap.get(proj.white);
    const bPlayer = playerMap.get(proj.black);
    if (
      wPlayer?.preferredColor !== 'none' &&
      wPlayer?.preferredColor !== 'white'
    )
      c12++;
    if (
      bPlayer?.preferredColor !== 'none' &&
      bPlayer?.preferredColor !== 'black'
    )
      c12++;
  }

  // C13: players not getting strong color preference
  let c13 = 0;
  for (const proj of projectedPairings) {
    const wPlayer = playerMap.get(proj.white);
    const bPlayer = playerMap.get(proj.black);
    if (
      (wPlayer?.preferenceStrength === 'absolute' ||
        wPlayer?.preferenceStrength === 'strong') &&
      wPlayer?.preferredColor !== 'white'
    )
      c13++;
    if (
      (bPlayer?.preferenceStrength === 'absolute' ||
        bPlayer?.preferenceStrength === 'strong') &&
      bPlayer?.preferredColor !== 'black'
    )
      c13++;
  }

  // C14: resident downfloaters who downfloated previous round
  let c14 = 0;
  for (const df of downfloaters) {
    if (df.floatHistory.at(-1) === 'down') c14++;
  }

  // C15: MDP opponents who upfloated previous round
  let c15 = 0;
  for (const [a, b] of pairings) {
    if (a.floatHistory.at(-1) === 'up') c15++;
    if (b.floatHistory.at(-1) === 'up') c15++;
  }

  // C16: resident downfloaters who downfloated 2 rounds ago
  let c16 = 0;
  for (const df of downfloaters) {
    if (df.floatHistory.length >= 2 && df.floatHistory.at(-2) === 'down') c16++;
  }

  // C17: MDP opponents who upfloated 2 rounds ago
  let c17 = 0;
  for (const [a, b] of pairings) {
    if (a.floatHistory.length >= 2 && a.floatHistory.at(-2) === 'up') c17++;
    if (b.floatHistory.length >= 2 && b.floatHistory.at(-2) === 'up') c17++;
  }

  // C18: score diffs of MDPs who downfloated previous round
  let c18 = 0;
  for (const [a, b] of pairings) {
    if (a.floatHistory.at(-1) === 'down') c18 += Math.abs(a.score - b.score);
    if (b.floatHistory.at(-1) === 'down') c18 += Math.abs(b.score - a.score);
  }

  // C19: score diffs of MDP opponents who upfloated previous round
  let c19 = 0;
  for (const [a, b] of pairings) {
    if (a.floatHistory.at(-1) === 'up') c19 += Math.abs(a.score - b.score);
    if (b.floatHistory.at(-1) === 'up') c19 += Math.abs(b.score - a.score);
  }

  // C20: score diffs of MDPs who downfloated 2 rounds ago
  let c20 = 0;
  for (const [a, b] of pairings) {
    if (a.floatHistory.length >= 2 && a.floatHistory.at(-2) === 'down')
      c20 += Math.abs(a.score - b.score);
    if (b.floatHistory.length >= 2 && b.floatHistory.at(-2) === 'down')
      c20 += Math.abs(b.score - a.score);
  }

  // C21: score diffs of MDP opponents who upfloated 2 rounds ago
  let c21 = 0;
  for (const [a, b] of pairings) {
    if (a.floatHistory.length >= 2 && a.floatHistory.at(-2) === 'up')
      c21 += Math.abs(a.score - b.score);
    if (b.floatHistory.length >= 2 && b.floatHistory.at(-2) === 'up')
      c21 += Math.abs(b.score - a.score);
  }

  void totalRounds;

  return [
    c5,
    c6,
    c7,
    c9,
    c10,
    c11,
    c12,
    c13,
    c14,
    c15,
    c16,
    c17,
    c18,
    c19,
    c20,
    c21,
  ];
}

function compareCosts(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function isPerfectCost(cost: number[]): boolean {
  return cost.every((v) => v === 0);
}

// ---------------------------------------------------------------------------
// Transposition generator (Article 4.2)
// Generates all orderings of s2 where first n1 are chosen in lex-ascending
// order by original index.
// ---------------------------------------------------------------------------

function* transpositions(
  s2: RankedPlayer[],
  n1: number,
): Generator<RankedPlayer[]> {
  if (n1 === 0) {
    yield [...s2];
    return;
  }
  if (n1 > s2.length) return;

  // Generate all C(s2.length, n1) combinations of indices in ascending order
  const indices = Array.from({ length: n1 }, (_, index) => index);

  while (true) {
    const chosen = indices.map((index) => s2[index] as RankedPlayer);
    const remaining = s2.filter((_, index) => !indices.includes(index));
    yield [...chosen, ...remaining];

    // Find next combination in lex order
    let pos = n1 - 1;
    while (pos >= 0 && (indices[pos] ?? 0) >= s2.length - (n1 - pos)) {
      pos--;
    }
    if (pos < 0) break;
    (indices as number[])[pos] = (indices[pos] ?? 0) + 1;
    for (let index = pos + 1; index < n1; index++) {
      indices[index] = (indices[index - 1] ?? 0) + 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Exchange generator (Article 4.3)
// ---------------------------------------------------------------------------

interface Exchange {
  newS1: RankedPlayer[];
  newS2: RankedPlayer[];
}

function generateExchanges(
  originalS1: RankedPlayer[],
  originalS2: RankedPlayer[],
): Exchange[] {
  // Build BSN map (1-indexed position in original combined sorted bracket)
  const allInBracket = sortByRank([...originalS1, ...originalS2]);
  const bsnMap = new Map<string, number>();
  for (const [index, p] of allInBracket.entries()) {
    bsnMap.set(p.id, index + 1);
  }

  // Store sort keys with each exchange to avoid recomputing during sort
  interface ExchangeWithKeys {
    incoming: RankedPlayer[];
    maxOut: number;
    minIn: number;
    newS1: RankedPlayer[];
    newS2: RankedPlayer[];
    outgoing: RankedPlayer[];
    sumDiff: number;
  }

  const withKeys: ExchangeWithKeys[] = [];

  // Try all possible swap sizes k (1 to min of both lengths)
  const maxK = Math.min(originalS1.length, originalS2.length);

  for (let k = 1; k <= maxK; k++) {
    const s1Combos = combinations(originalS1.length, k);
    const s2Combos = combinations(originalS2.length, k);

    for (const s1Indices of s1Combos) {
      for (const s2Indices of s2Combos) {
        const outgoing = s1Indices.map(
          (index) => originalS1[index] as RankedPlayer,
        );
        const incoming = s2Indices.map(
          (index) => originalS2[index] as RankedPlayer,
        );

        const newS1Raw = [
          ...originalS1.filter((_, index) => !s1Indices.includes(index)),
          ...incoming,
        ];
        const newS2Raw = [
          ...originalS2.filter((_, index) => !s2Indices.includes(index)),
          ...outgoing,
        ];

        const newS1 = sortByRank(newS1Raw);
        const newS2 = sortByRank(newS2Raw);

        // Pre-compute sort keys
        const sumIn = incoming.reduce((s, p) => s + (bsnMap.get(p.id) ?? 0), 0);
        const sumOut = outgoing.reduce(
          (s, p) => s + (bsnMap.get(p.id) ?? 0),
          0,
        );
        const maxOut =
          outgoing.length > 0
            ? Math.max(...outgoing.map((p) => bsnMap.get(p.id) ?? 0))
            : 0;
        const minIn =
          incoming.length > 0
            ? Math.min(...incoming.map((p) => bsnMap.get(p.id) ?? Infinity))
            : Infinity;

        withKeys.push({
          incoming,
          maxOut,
          minIn,
          newS1,
          newS2,
          outgoing,
          sumDiff: sumIn - sumOut,
        });
      }
    }
  }

  // Sort by Article 4.3.2 rules (keys pre-computed)
  const sortedWithKeys = withKeys.toSorted((a, b) => {
    if (a.outgoing.length !== b.outgoing.length)
      return a.outgoing.length - b.outgoing.length;
    if (a.sumDiff !== b.sumDiff) return a.sumDiff - b.sumDiff;
    if (a.maxOut !== b.maxOut) return b.maxOut - a.maxOut;
    return a.minIn - b.minIn;
  });

  return sortedWithKeys.map(({ newS1, newS2 }) => ({ newS1, newS2 }));
}

function combinations(n: number, k: number): number[][] {
  if (k === 0) return [[]];
  if (k > n) return [];
  const result: number[][] = [];
  const indices = Array.from({ length: k }, (_, index) => index);
  while (true) {
    result.push([...indices]);
    let pos = k - 1;
    while (pos >= 0 && (indices[pos] ?? 0) >= n - (k - pos)) pos--;
    if (pos < 0) break;
    (indices as number[])[pos] = (indices[pos] ?? 0) + 1;
    for (let index = pos + 1; index < k; index++)
      indices[index] = (indices[index - 1] ?? 0) + 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Try all transpositions for given S1/S2, return best candidate
// ---------------------------------------------------------------------------

function tryTranspositions(
  s1: RankedPlayer[],
  s2: RankedPlayer[],
  games: Game[][],
  playerMap: Map<string, RankedPlayer>,
  totalRounds: number,
  bracketIsLast: boolean,
): { bestCandidate: Candidate | undefined; bestCost: number[] | undefined } {
  let bestCandidate: Candidate | undefined;
  let bestCost: number[] | undefined;

  const n1 = s1.length;

  for (const transposed of transpositions(s2, n1)) {
    const pairings: [RankedPlayer, RankedPlayer][] = [];
    for (let index = 0; index < n1; index++) {
      const p1 = s1[index] as RankedPlayer;
      const p2 = transposed[index] as RankedPlayer;
      pairings.push([p1, p2]);
    }
    const downfloaters = transposed.slice(n1);

    const candidate: Candidate = { downfloaters, pairings };
    const cost = evaluateCandidate(
      candidate,
      games,
      playerMap,
      totalRounds,
      bracketIsLast,
    );

    if (cost === undefined) continue;

    if (isPerfectCost(cost))
      return { bestCandidate: candidate, bestCost: cost };

    if (bestCost === undefined || compareCosts(cost, bestCost) < 0) {
      bestCandidate = candidate;
      bestCost = cost;
    }
  }

  return { bestCandidate, bestCost };
}

// ---------------------------------------------------------------------------
// Greedy + augmenting path fallback for large brackets.
// For most rounds the greedy is sufficient. For late rounds with many
// rematches, we use BFS-based augmenting paths to maximize the matching.
// ---------------------------------------------------------------------------

function maxMatchingPair(sorted: RankedPlayer[], games: Game[][]): Candidate {
  if (sorted.length === 0) return { downfloaters: [], pairings: [] };

  const n = sorted.length;
  const maxPairs = Math.floor(n / 2);

  // Try with C3 strict, then relax C3
  for (const relaxC3 of [false, true]) {
    // Build adjacency lists for the validity graph
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let index = 0; index < n; index++) {
      for (let index_ = index + 1; index_ < n; index_++) {
        const playerA = sorted[index] as RankedPlayer;
        const playerB = sorted[index_] as RankedPlayer;
        if (isValidPair(playerA, playerB, games, relaxC3)) {
          (adj[index] as number[]).push(index_);
          (adj[index_] as number[]).push(index);
        }
      }
    }

    // Greedy initial matching
    const match: number[] = Array.from({ length: n }).map(() => -1);
    for (const [index] of sorted.entries()) {
      if (match[index] !== -1) continue;
      for (const index_ of adj[index] ?? []) {
        if (match[index_] === -1) {
          match[index] = index_;
          match[index_] = index;
          break;
        }
      }
    }

    // BFS augmenting paths to improve the matching
    let improved = true;
    while (improved) {
      improved = false;
      for (const [start] of sorted.entries()) {
        if (match[start] !== -1) continue;

        // BFS from `start` looking for an augmenting path
        // parent[v]: -2 = unvisited, -1 = root, otherwise = predecessor
        const parent: number[] = Array.from({ length: n }).map(() => -2);
        parent[start] = -1;
        const queue: number[] = [start];
        let found = -1;

        // Use index-based iteration because queue grows during BFS traversal
        let qiOuter = 0;
        outer: while (qiOuter < queue.length) {
          const v = queue[qiOuter++] ?? -1;
          if (v === -1) break;
          for (const u of adj[v] ?? []) {
            if ((parent[u] ?? -2) !== -2) continue;
            parent[u] = v;
            if (match[u] === -1) {
              found = u;
              break outer;
            }
            // u is matched; continue BFS through its match
            const w = match[u] ?? -1;
            if ((parent[w] ?? -2) === -2) {
              parent[w] = u;
              queue.push(w);
            }
          }
        }

        if (found === -1) continue;

        // Augment along the path from `start` to `found`
        let current = found;
        while (current !== start && current !== -1) {
          const previous = parent[current] ?? -2;
          if (previous === -2 || previous === -1) break;
          const previousPrevious = parent[previous] ?? -2;
          match[current] = previous;
          match[previous] = current;
          current = previousPrevious === -2 ? -1 : previousPrevious;
        }
        if (current === start) {
          const pf = parent[found] ?? found;
          match[start] = pf;
          match[pf] = start;
        }
        improved = true;
        break;
      }
    }

    // Build result
    const pairings: [RankedPlayer, RankedPlayer][] = [];
    const used = new Set<number>();
    for (const [index] of sorted.entries()) {
      const index_ = match[index] ?? -1;
      if (index_ !== -1 && index_ > index) {
        const pa = sorted[index] as RankedPlayer;
        const pb = sorted[index_] as RankedPlayer;
        pairings.push([pa, pb]);
        used.add(index);
        used.add(index_);
      }
    }

    const downfloaters = sorted.filter((_, index) => !used.has(index));
    if (pairings.length >= maxPairs || relaxC3) {
      return { downfloaters, pairings };
    }
  }

  return { downfloaters: sorted, pairings: [] };
}

// ---------------------------------------------------------------------------
// Homogeneous bracket pairing (Article 4.2 + 4.3)
// For small brackets: full transposition/exchange enumeration.
// For large brackets: greedy fallback.
// ---------------------------------------------------------------------------

function pairHomogeneous(
  bracket: RankedPlayer[],
  games: Game[][],
  playerMap: Map<string, RankedPlayer>,
  totalRounds: number,
  bracketIsLast: boolean,
): Candidate {
  if (bracket.length === 0) return { downfloaters: [], pairings: [] };
  if (bracket.length === 1) {
    return { downfloaters: [bracket[0] as RankedPlayer], pairings: [] };
  }

  const sorted = sortByRank(bracket);

  // For large brackets, use greedy to avoid combinatorial explosion
  if (sorted.length > FIDE_EXACT_LIMIT) {
    return maxMatchingPair(sorted, games);
  }

  const maxPairs = Math.floor(sorted.length / 2);
  const originalS1 = sorted.slice(0, maxPairs);
  const originalS2 = sorted.slice(maxPairs);

  let bestCandidate: Candidate | undefined;
  let bestCost: number[] | undefined;

  // Phase 1: try all transpositions of original S1/S2
  const t1 = tryTranspositions(
    originalS1,
    originalS2,
    games,
    playerMap,
    totalRounds,
    bracketIsLast,
  );
  if (t1.bestCandidate !== undefined && t1.bestCost !== undefined) {
    if (isPerfectCost(t1.bestCost)) return t1.bestCandidate;
    bestCandidate = t1.bestCandidate;
    bestCost = t1.bestCost;
  }

  // Phase 2: try exchanges
  const exchanges = generateExchanges(originalS1, originalS2);
  for (const { newS1, newS2 } of exchanges) {
    const t2 = tryTranspositions(
      newS1,
      newS2,
      games,
      playerMap,
      totalRounds,
      bracketIsLast,
    );
    if (t2.bestCandidate !== undefined && t2.bestCost !== undefined) {
      if (isPerfectCost(t2.bestCost)) return t2.bestCandidate;
      if (bestCost === undefined || compareCosts(t2.bestCost, bestCost) < 0) {
        bestCandidate = t2.bestCandidate;
        bestCost = t2.bestCost;
      }
    }
  }

  // Return best found, or if nothing valid found, use greedy
  return bestCandidate ?? maxMatchingPair(sorted, games);
}

// ---------------------------------------------------------------------------
// Heterogeneous bracket pairing
// ---------------------------------------------------------------------------

function pairHeterogeneous(
  mdps: RankedPlayer[],
  residents: RankedPlayer[],
  games: Game[][],
  playerMap: Map<string, RankedPlayer>,
  totalRounds: number,
  bracketIsLast: boolean,
): Candidate {
  if (mdps.length === 0) {
    return pairHomogeneous(
      residents,
      games,
      playerMap,
      totalRounds,
      bracketIsLast,
    );
  }

  const m0 = mdps.length;
  const m1 = Math.min(m0, residents.length);

  if (m1 === 0) {
    // No residents to pair MDPs with — all MDPs downfloat
    const residentsResult = pairHomogeneous(
      residents,
      games,
      playerMap,
      totalRounds,
      bracketIsLast,
    );
    return {
      downfloaters: [...mdps, ...residentsResult.downfloaters],
      pairings: residentsResult.pairings,
    };
  }

  const sortedMdps = sortByRank(mdps);
  const sortedResidents = sortByRank(residents);

  // For large heterogeneous brackets, use greedy on combined pool
  if (sortedMdps.length + sortedResidents.length > FIDE_EXACT_LIMIT) {
    return maxMatchingPair([...sortedMdps, ...sortedResidents], games);
  }

  let bestCandidate: Candidate | undefined;
  let bestCost: number[] | undefined;

  // Try all subsets of m1 MDPs from sortedMdps (Article 4.4.2)
  const mdpCombos = combinations(sortedMdps.length, m1);

  for (const mdpIndices of mdpCombos) {
    const s1 = mdpIndices.map((index) => sortedMdps[index] as RankedPlayer);
    const limbo = sortedMdps.filter((_, index) => !mdpIndices.includes(index));
    const s2 = sortedResidents;

    // Try all transpositions of residents
    const n1 = s1.length;
    for (const transposed of transpositions(s2, n1)) {
      const mdpPairings: [RankedPlayer, RankedPlayer][] = [];
      let valid = true;
      for (let index = 0; index < n1; index++) {
        const p1 = s1[index] as RankedPlayer;
        const p2 = transposed[index] as RankedPlayer;
        if (!isValidPair(p1, p2, games, false)) {
          valid = false;
          break;
        }
        mdpPairings.push([p1, p2]);
      }
      if (!valid) continue;

      const remainingResidents = transposed.slice(n1);

      // Pair remaining residents as homogeneous
      const remainder = pairHomogeneous(
        remainingResidents,
        games,
        playerMap,
        totalRounds,
        bracketIsLast,
      );

      const candidate: Candidate = {
        downfloaters: [...limbo, ...remainder.downfloaters],
        pairings: [...mdpPairings, ...remainder.pairings],
      };

      const cost = evaluateCandidate(
        candidate,
        games,
        playerMap,
        totalRounds,
        bracketIsLast,
      );
      if (cost === undefined) continue;

      if (isPerfectCost(cost)) return candidate;

      if (bestCost === undefined || compareCosts(cost, bestCost) < 0) {
        bestCandidate = candidate;
        bestCost = cost;
      }
    }
  }

  if (bestCandidate !== undefined) return bestCandidate;

  // Fall back to greedy on combined pool
  return maxMatchingPair([...sortedMdps, ...sortedResidents], games);
}

// ---------------------------------------------------------------------------
// Bracket dispatcher
// ---------------------------------------------------------------------------

function pairBracket(
  bracket: RankedPlayer[],
  games: Game[][],
  playerMap: Map<string, RankedPlayer>,
  totalRounds: number,
  bracketIsLast: boolean,
): Candidate {
  if (bracket.length === 0) return { downfloaters: [], pairings: [] };

  const scores = new Set(bracket.map((p) => p.score));
  if (scores.size === 1) {
    return pairHomogeneous(
      bracket,
      games,
      playerMap,
      totalRounds,
      bracketIsLast,
    );
  }

  // Heterogeneous: MDPs are higher-score players, residents are lowest score
  const minScore = Math.min(...bracket.map((p) => p.score));
  const allMdps = bracket.filter((p) => p.score > minScore);
  const allResidents = bracket.filter((p) => p.score === minScore);

  return pairHeterogeneous(
    allMdps,
    allResidents,
    games,
    playerMap,
    totalRounds,
    bracketIsLast,
  );
}

// ---------------------------------------------------------------------------
// Main pair function
// ---------------------------------------------------------------------------

function pair(players: Player[], games: Game[][]): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const totalRounds = games.length + 1;
  const ranked = sortByRank(buildRankedPlayers(players, games));
  const needsBye = ranked.length % 2 === 1;

  // Build a Map for O(1) player lookup by id
  const playerMap = new Map<string, RankedPlayer>();
  for (const p of ranked) {
    playerMap.set(p.id, p);
  }

  // Build score groups descending — all players included
  const scoreGroupMap = new Map<number, RankedPlayer[]>();
  for (const player of ranked) {
    const group = scoreGroupMap.get(player.score) ?? [];
    group.push(player);
    scoreGroupMap.set(player.score, group);
  }

  const scoreGroupsSorted = [...scoreGroupMap.entries()]
    .toSorted((a, b) => b[0] - a[0])
    .map(([, group]) => group);

  const allPairings: [RankedPlayer, RankedPlayer][] = [];
  let downfloatersFromAbove: RankedPlayer[] = [];

  for (let index = 0; index < scoreGroupsSorted.length; index++) {
    const residents = scoreGroupsSorted[index] as RankedPlayer[];
    const isLastBracket = index === scoreGroupsSorted.length - 1;

    const bracket = [...downfloatersFromAbove, ...residents];

    const result = pairBracket(
      bracket,
      games,
      playerMap,
      totalRounds,
      isLastBracket,
    );

    allPairings.push(...result.pairings);
    downfloatersFromAbove = result.downfloaters;

    if (isLastBracket && downfloatersFromAbove.length > 0) {
      // Remaining unpaired players after last bracket — force-pair best-effort
      const remaining = sortByRank(downfloatersFromAbove);
      const forced = maxMatchingPair(remaining, games);
      allPairings.push(...forced.pairings);
    }
  }

  // Check if all players (except possible bye) are paired.
  // If not, fall back to global matching on the entire player pool.
  const pairedIdsCheck = new Set(allPairings.flatMap(([a, b]) => [a.id, b.id]));
  const unpaired = ranked.filter((p) => !pairedIdsCheck.has(p.id));
  const expectedUnpaired = needsBye ? 1 : 0;

  if (unpaired.length > expectedUnpaired) {
    // Global fallback: ignore score group structure, match all players together
    const globalResult = maxMatchingPair(ranked, games);
    return {
      byes: needsBye
        ? (() => {
            const globalPairedIds = new Set(
              globalResult.pairings.flatMap(([a, b]) => [a.id, b.id]),
            );
            const globalUnpaired = ranked.find(
              (p) => !globalPairedIds.has(p.id),
            );
            return globalUnpaired === undefined
              ? []
              : [{ player: globalUnpaired.id }];
          })()
        : [],
      pairings: globalResult.pairings.map(([higher, lower]) =>
        allocateColor(higher, lower),
      ),
    };
  }

  // Determine the bye recipient (odd tournament: one player left unpaired)
  let byePlayer: RankedPlayer | undefined;
  if (needsBye) {
    const pairedIds = new Set(allPairings.flatMap(([a, b]) => [a.id, b.id]));
    byePlayer = ranked.find((p) => !pairedIds.has(p.id));
  }

  return {
    byes: byePlayer === undefined ? [] : [{ player: byePlayer.id }],
    pairings: allPairings.map(([higher, lower]) =>
      allocateColor(higher, lower),
    ),
  };
}

export { pair };
