import {
  assignBye,
  colorHistory,
  colorPreference,
  hasFaced,
  rankPlayers,
  scoreGroups,
} from './utilities.js';

import type { Game, PairingResult, Player } from './types.js';

/** Direction of scoregroup traversal. */
type Direction = 'down' | 'up';

/**
 * Returns the median score for a given number of rounds played.
 * Players at this score are paired last in Lim's bi-directional order.
 */
function medianScore(roundsPlayed: number): number {
  return roundsPlayed / 2;
}

/**
 * Checks whether two players are compatible for pairing under FIDE C.04.4.3
 * Articles 2.1, 5.1.1, and 5.1.2.
 *
 * In the last round, only the rematch constraint is checked (Article 6).
 */
function isLimCompatible(
  a: Player,
  b: Player,
  games: Game[][],
  isLastRound: boolean,
): boolean {
  // Article 2.1.1: no rematches
  if (hasFaced(a.id, b.id, games)) {
    return false;
  }

  if (isLastRound) {
    // Article 6: same-score pairing has priority over color rules
    return true;
  }

  const histA = colorHistory(a.id, games);
  const histB = colorHistory(b.id, games);
  const lastTwoA = histA.slice(-2);
  const lastTwoB = histB.slice(-2);

  // Article 5.1.1: no 3 same colors in a row
  const aLastTwoSame = lastTwoA.length === 2 && lastTwoA[0] === lastTwoA[1];
  const bLastTwoSame = lastTwoB.length === 2 && lastTwoB[0] === lastTwoB[1];

  if (aLastTwoSame && bLastTwoSame) {
    // Both need alternates — they can only be paired if they need opposite alternates
    const aNeeds = lastTwoA[0] === 'white' ? 'black' : 'white';
    const bNeeds = lastTwoB[0] === 'white' ? 'black' : 'white';
    if (aNeeds === bNeeds) {
      // Both need the same color — incompatible (one would get 3 in a row)
      return false;
    }
  }

  // Article 5.1.2: no 3+ color imbalance
  // Check if at least one valid color assignment exists
  const prefA = colorPreference(a.id, games);
  const prefB = colorPreference(b.id, games);

  // colorPreference: positive = player has played more black, prefers white
  // If we give a player white, their diff (blacks - whites) decreases by 1
  // If we give a player black, their diff increases by 1
  // Bad if |diff| would reach 3 or more

  const canAWhite = prefA - 1 > -3; // giving white: new diff = prefA-1; bad if <= -2 (3+ white excess)
  const canABlack = prefA + 1 < 3; // giving black: new diff = prefA+1; bad if >= 2 (3+ black excess)
  const canBWhite = prefB - 1 > -3;
  const canBBlack = prefB + 1 < 3;

  // Check if any valid assignment exists
  const assignment1Valid = canAWhite && canBBlack; // a=white, b=black
  const assignment2Valid = canABlack && canBWhite; // a=black, b=white

  return assignment1Valid || assignment2Valid;
}

/**
 * Returns score values in Lim's bi-directional order (Article 2.2):
 * highest → down to just before median, then lowest → up to median.
 * Median scoregroup is processed last.
 */
function limPairingOrder(
  groups: Map<number, Player[]>,
  roundsPlayed: number,
): number[] {
  const scores = [...groups.keys()].toSorted((a, b) => b - a);
  const median = medianScore(roundsPlayed);

  const aboveMedian = scores.filter((s) => s > median);
  const belowMedian = scores.filter((s) => s < median);
  const atMedian = scores.filter((s) => s === median);

  // Bi-directional: highest first, then lowest (ascending from below), median last
  return [...aboveMedian, ...belowMedian.toReversed(), ...atMedian];
}

/**
 * Tries to find a complete valid matching for the given group.
 *
 * Uses the Lim top/bottom half split as the first proposal (Article 2.4),
 * then tries all possible exchanges (Article 4) until a fully compatible
 * matching is found.
 *
 * Falls back to relaxed matching (allowing rematches) when no perfect
 * compatible matching exists.
 *
 * Returns an array of index pairs [topIndex, bottomIndex].
 */
function findBestMatching(
  group: Player[],
  games: Game[][],
): [number, number][] {
  const half = Math.floor(group.length / 2);
  if (half === 0) {
    return [];
  }

  // Try to find a valid matching with no rematches and color constraints
  const strictMatching = tryFindMatching(group, games, false);
  if (strictMatching !== undefined) {
    return strictMatching;
  }

  // Relax color constraints (last-round mode)
  const relaxedMatching = tryFindMatching(group, games, true);
  if (relaxedMatching !== undefined) {
    return relaxedMatching;
  }

  // Last resort: allow rematches — just pair in order
  const lastResort: [number, number][] = [];
  const used = new Set<number>();
  for (let index = 0; index < group.length; index++) {
    if (used.has(index)) {
      continue;
    }
    for (let index_ = index + 1; index_ < group.length; index_++) {
      if (used.has(index_)) {
        continue;
      }
      lastResort.push([index, index_]);
      used.add(index);
      used.add(index_);
      break;
    }
  }
  return lastResort;
}

/**
 * Tries to find a complete valid matching using backtracking.
 * Starts from the Lim top/bottom proposal and exchanges as needed.
 */
function tryFindMatching(
  group: Player[],
  games: Game[][],
  relaxColors: boolean,
): [number, number][] | undefined {
  const half = Math.floor(group.length / 2);

  // Try all possible matchings via backtracking.
  // To stay close to the Lim proposal, we enumerate in a specific order.
  return backtrackMatch(group, games, relaxColors, half, 0, new Set());
}

/**
 * Backtracking matching: pairs player at topIndex with some available
 * bottom-half player, then recurses.
 */
function backtrackMatch(
  group: Player[],
  games: Game[][],
  relaxColors: boolean,
  half: number,
  topIndex: number,
  usedBottoms: Set<number>,
): [number, number][] | undefined {
  if (topIndex >= half) {
    // All top-half players paired
    return [];
  }

  const topPlayer = group[topIndex];
  if (topPlayer === undefined) {
    return undefined;
  }

  // Try bottom-half partners in order: proposed first (half + topIndex),
  // then others by increasing distance from the proposed position.
  const proposedBottom = half + topIndex;
  const candidateBottoms = getBottomCandidates(
    half,
    group.length,
    proposedBottom,
  );

  for (const bottomIndex of candidateBottoms) {
    if (usedBottoms.has(bottomIndex)) {
      continue;
    }
    const bottomPlayer = group[bottomIndex];
    if (bottomPlayer === undefined) {
      continue;
    }
    if (isLimCompatible(topPlayer, bottomPlayer, games, relaxColors)) {
      const newUsed = new Set(usedBottoms);
      newUsed.add(bottomIndex);
      const rest = backtrackMatch(
        group,
        games,
        relaxColors,
        half,
        topIndex + 1,
        newUsed,
      );
      if (rest !== undefined) {
        return [[topIndex, bottomIndex], ...rest];
      }
    }
  }

  return undefined;
}

/**
 * Returns bottom-half indices in preference order for Lim pairing.
 * Starts with the proposed index, then alternates outward.
 */
function getBottomCandidates(
  half: number,
  groupLength: number,
  proposedBottom: number,
): number[] {
  const candidates: number[] = [proposedBottom];
  let lo = proposedBottom - 1;
  let hi = proposedBottom + 1;

  while (lo >= half || hi < groupLength) {
    if (hi < groupLength) {
      candidates.push(hi);
      hi++;
    }
    if (lo >= half) {
      candidates.push(lo);
      lo--;
    }
  }

  return candidates;
}

/**
 * Selects which player should float out of the given group to the adjacent
 * scoregroup (Article 3).
 *
 * When pairing downward (float to lower group): choose lowest-numbered
 * (highest-indexed in ranked order) player.
 * When pairing upward (float to higher group): choose highest-numbered
 * (lowest-indexed in ranked order) player.
 */
function selectFloater(
  group: Player[],
  direction: Direction,
): Player | undefined {
  if (direction === 'down') {
    return group.at(-1);
  }
  return group[0];
}

/**
 * Allocates colors for a pairing according to FIDE C.04.4.3 Article 5.
 */
function allocateLimColors(
  a: Player,
  b: Player,
  games: Game[][],
  ranked: Player[],
): { blackId: string; whiteId: string } {
  const histA = colorHistory(a.id, games);
  const histB = colorHistory(b.id, games);
  const lastTwoA = histA.slice(-2);
  const lastTwoB = histB.slice(-2);

  const aLastTwoSame = lastTwoA.length === 2 && lastTwoA[0] === lastTwoA[1];
  const bLastTwoSame = lastTwoB.length === 2 && lastTwoB[0] === lastTwoB[1];

  // Article 5.3: player with same color last 2 rounds MUST get alternate
  if (aLastTwoSame && !bLastTwoSame) {
    const aColor = lastTwoA[0];
    return aColor === 'white'
      ? { blackId: a.id, whiteId: b.id }
      : { blackId: b.id, whiteId: a.id };
  }
  if (bLastTwoSame && !aLastTwoSame) {
    const bColor = lastTwoB[0];
    return bColor === 'white'
      ? { blackId: b.id, whiteId: a.id }
      : { blackId: a.id, whiteId: b.id };
  }
  if (aLastTwoSame && bLastTwoSame) {
    // Both need alternates — they need opposite colors (guaranteed by isLimCompatible)
    const aNeeds = lastTwoA[0] === 'white' ? 'black' : 'white';
    return aNeeds === 'white'
      ? { blackId: b.id, whiteId: a.id }
      : { blackId: a.id, whiteId: b.id };
  }

  // Use color preference to determine colors
  const prefA = colorPreference(a.id, games);
  const prefB = colorPreference(b.id, games);

  if (prefA !== prefB) {
    // Give white to player with more black excess (positive pref = played more black = wants white)
    if (prefA > prefB) {
      return { blackId: b.id, whiteId: a.id };
    }
    return { blackId: a.id, whiteId: b.id };
  }

  // Equal preference: use rank (index in ranked array) for tiebreak
  // Article 5.4: higher-ranked player gets the alternate from their last round
  const rankA = ranked.findIndex((p) => p.id === a.id);
  const rankB = ranked.findIndex((p) => p.id === b.id);
  const lastA = histA.at(-1);
  const lastB = histB.at(-1);

  if (lastA !== undefined || lastB !== undefined) {
    // Give alternate to higher-ranked player (lower index = higher rank)
    if (rankA <= rankB) {
      // a is higher ranked — give a the alternate from last round
      const alternate = lastA === 'white' ? 'black' : 'white';
      return alternate === 'white'
        ? { blackId: b.id, whiteId: a.id }
        : { blackId: a.id, whiteId: b.id };
    } else {
      const alternate = lastB === 'white' ? 'black' : 'white';
      return alternate === 'white'
        ? { blackId: a.id, whiteId: b.id }
        : { blackId: b.id, whiteId: a.id };
    }
  }

  // Round 1 or no history: higher-ranked (lower index) gets white
  if (rankA <= rankB) {
    return { blackId: b.id, whiteId: a.id };
  }
  return { blackId: a.id, whiteId: b.id };
}

/**
 * Pairs a scoregroup (or merged group with floaters), returning pairings and
 * any players that couldn't be paired (to be floated down/up).
 */
function pairGroup(
  group: Player[],
  games: Game[][],
  ranked: Player[],
): { pairings: { blackId: string; whiteId: string }[]; unpaired: Player[] } {
  if (group.length < 2) {
    return { pairings: [], unpaired: [...group] };
  }

  const matching = findBestMatching(group, games);
  const paired = new Set<number>();
  const pairings: { blackId: string; whiteId: string }[] = [];

  for (const [ti, bi] of matching) {
    const topPlayer = group[ti];
    const bottomPlayer = group[bi];
    if (topPlayer !== undefined && bottomPlayer !== undefined) {
      pairings.push(allocateLimColors(topPlayer, bottomPlayer, games, ranked));
      paired.add(ti);
      paired.add(bi);
    }
  }

  const unpaired = group.filter((_, index) => !paired.has(index));

  return { pairings, unpaired };
}

/**
 * Finds the score value adjacent to currentScore in the given direction.
 */
function findNextScore(
  order: number[],
  currentScore: number,
  direction: 'down' | 'up',
): number | undefined {
  if (direction === 'down') {
    let best: number | undefined;
    for (const s of order) {
      if (s < currentScore && (best === undefined || s > best)) {
        best = s;
      }
    }
    return best;
  } else {
    let best: number | undefined;
    for (const s of order) {
      if (s > currentScore && (best === undefined || s < best)) {
        best = s;
      }
    }
    return best;
  }
}

/**
 * Implements the Lim pairing system (FIDE C.04.4.3).
 */
function pair(players: Player[], games: Game[][]): PairingResult {
  if (players.length < 2) {
    throw new RangeError('at least 2 players are required');
  }

  const ranked = rankPlayers(players, games);
  const byePlayer = assignBye(ranked, games);
  const toBePaired = ranked.filter((p) => p.id !== byePlayer?.id);
  const roundsPlayed = games.length;

  const allPairings: { blackId: string; whiteId: string }[] = [];
  const alreadyPaired = new Set<string>();

  // Get score groups
  const groups = scoreGroups(toBePaired, games);
  const order = limPairingOrder(groups, roundsPlayed);

  // Build mutable group arrays (maintaining ranked order within each group)
  const groupMap = new Map<number, Player[]>();
  for (const s of order) {
    const groupPlayers = groups.get(s) ?? [];
    // Sort within group by ranking position
    const sortedGroup = [...groupPlayers].toSorted(
      (a, b) => ranked.indexOf(a) - ranked.indexOf(b),
    );
    groupMap.set(s, sortedGroup);
  }

  // Track floaters flowing into each score group
  const incomingFloaters = new Map<number, Player[]>();

  for (const currentScore of order) {
    const baseGroup = groupMap.get(currentScore) ?? [];
    const floaters = incomingFloaters.get(currentScore) ?? [];

    // Merge incoming floaters with the current group
    // Floaters from above (down-floaters) come first; from below (up-floaters) come last
    const mergedGroup = [
      ...floaters.filter((p) => !alreadyPaired.has(p.id)),
      ...baseGroup.filter((p) => !alreadyPaired.has(p.id)),
    ];

    if (mergedGroup.length === 0) {
      continue;
    }

    // Determine direction for this group
    const median = medianScore(roundsPlayed);
    let direction: Direction;
    if (currentScore > median) {
      direction = 'down';
    } else if (currentScore < median) {
      direction = 'up';
    } else {
      // Median group: use 'down' as default
      direction = 'down';
    }

    // If odd count, select a floater before pairing (Article 2.3.4)
    let groupToPair = mergedGroup;
    let floaterOut: Player | undefined;

    if (mergedGroup.length % 2 !== 0) {
      floaterOut = selectFloater(mergedGroup, direction);
      if (floaterOut !== undefined) {
        groupToPair = mergedGroup.filter((p) => p.id !== floaterOut?.id);
      }
    }

    const { pairings, unpaired } = pairGroup(groupToPair, games, ranked);

    for (const pairing of pairings) {
      allPairings.push(pairing);
      alreadyPaired.add(pairing.whiteId);
      alreadyPaired.add(pairing.blackId);
    }

    // Collect all players that need to float
    const allUnpaired = [
      ...unpaired,
      ...(floaterOut === undefined ? [] : [floaterOut]),
    ].filter((p) => !alreadyPaired.has(p.id));

    // Route unpaired players to adjacent scoregroups
    for (const player of allUnpaired) {
      let targetScore: number | undefined;

      if (direction === 'down') {
        // Float to next lower-score group
        targetScore = findNextScore(order, currentScore, 'down');
        if (targetScore === undefined) {
          // No lower group; float to next higher
          targetScore = findNextScore(order, currentScore, 'up');
        }
      } else {
        // Float to next higher-score group
        targetScore = findNextScore(order, currentScore, 'up');
        if (targetScore === undefined) {
          // No higher group; float to next lower
          targetScore = findNextScore(order, currentScore, 'down');
        }
      }

      if (targetScore !== undefined) {
        const existing = incomingFloaters.get(targetScore) ?? [];
        existing.push(player);
        incomingFloaters.set(targetScore, existing);
      }
    }
  }

  // Any remaining unpaired players — do a best-effort pairing (allow rematches)
  const remainingUnpaired = toBePaired.filter((p) => !alreadyPaired.has(p.id));
  if (remainingUnpaired.length >= 2) {
    const { pairings } = pairGroup(remainingUnpaired, games, ranked);
    for (const pairing of pairings) {
      allPairings.push(pairing);
      alreadyPaired.add(pairing.whiteId);
      alreadyPaired.add(pairing.blackId);
    }
  }

  return {
    byes: byePlayer === undefined ? [] : [{ playerId: byePlayer.id }],
    pairings: allPairings,
  };
}

export { pair };
