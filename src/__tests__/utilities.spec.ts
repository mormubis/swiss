import { describe, expect, it } from 'vitest';

import {
  allocateColor,
  assignBye,
  buildPlayerStates,
  scoreGroups,
} from '../utilities.js';

import type { Game, Player } from '../types.js';
import type { PlayerState } from '../utilities.js';

const PLAYERS: Player[] = [
  { id: 'A', rating: 2000 },
  { id: 'B', rating: 1900 },
  { id: 'C', rating: 1800 },
  { id: 'D', rating: 1700 },
];

// Round 1: A(w) 1-0 B, C(w) 0-1 D
// Round 2: C(w) 0.5-0.5 A, D(w) 0-1 B
const GAMES: Game[][] = [
  [
    { black: 'B', result: 1, white: 'A' },
    { black: 'D', result: 0, white: 'C' },
  ],
  [
    { black: 'A', result: 0.5, white: 'C' },
    { black: 'B', result: 0, white: 'D' },
  ],
];

// ---------------------------------------------------------------------------
// Helpers used by allocateColor tests
// ---------------------------------------------------------------------------

function makeState(
  id: string,
  score: number,
  tpn: number,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return {
    byeCount: 0,
    colorDiff: 0,
    colorHistory: [],
    floatHistory: [],
    id,
    opponents: new Set(),
    preferenceStrength: 'none',
    preferredColor: undefined,
    score,
    tpn,
    unplayedRounds: 0,
    ...overrides,
  };
}

const tiebreakByTpnAsc = (a: PlayerState, b: PlayerState) => a.tpn - b.tpn;
const tiebreakByTpnDesc = (a: PlayerState, b: PlayerState) => b.tpn - a.tpn;
const rankByTpnAsc = (x: PlayerState, y: PlayerState) => x.tpn - y.tpn;

const ruleHrpWhite = () => 'hrp-white' as const;
const ruleHrpBlack = () => 'hrp-black' as const;
const ruleContinue = () => 'continue' as const;

describe('buildPlayerStates', () => {
  describe('scores', () => {
    it('computes A score as 1.5 (won R1 as white, drew R2 as black)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.score).toBe(1.5);
    });

    it('computes B score as 1 (lost R1 as black, won R2 as black)', () => {
      // B: R1 black, white(A) result=1 → B gets 1-1=0; R2 black, white(D) result=0 → B gets 1-0=1
      const states = buildPlayerStates(PLAYERS, GAMES);
      const b = states.find((s) => s.id === 'B');
      expect(b?.score).toBe(1);
    });

    it('computes C score as 0.5 (lost R1 as white, drew R2 as white)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const c = states.find((s) => s.id === 'C');
      expect(c?.score).toBe(0.5);
    });

    it('computes D score as 1 (won R1 as black, lost R2 as white)', () => {
      // D: R1 black, white(C) result=0 → D gets 1-0=1; R2 white, result=0 → D gets 0
      const states = buildPlayerStates(PLAYERS, GAMES);
      const d = states.find((s) => s.id === 'D');
      expect(d?.score).toBe(1);
    });

    it('returns 0 for player with no games', () => {
      const states = buildPlayerStates([{ id: 'Z' }], []);
      expect(states[0]?.score).toBe(0);
    });

    it('counts pairing-bye score (1 point)', () => {
      const byeGames: Game[][] = [
        [{ black: '', kind: 'pairing-bye', result: 1, white: 'A' }],
      ];
      const states = buildPlayerStates([{ id: 'A' }], byeGames);
      expect(states[0]?.score).toBe(1);
    });

    it('counts half-bye score (0.5 points)', () => {
      const byeGames: Game[][] = [
        [{ black: '', kind: 'half-bye', result: 0.5, white: 'A' }],
      ];
      const states = buildPlayerStates([{ id: 'A' }], byeGames);
      expect(states[0]?.score).toBe(0.5);
    });

    it('counts zero-bye score (0 points)', () => {
      const byeGames: Game[][] = [
        [{ black: '', kind: 'zero-bye', result: 0, white: 'A' }],
      ];
      const states = buildPlayerStates([{ id: 'A' }], byeGames);
      expect(states[0]?.score).toBe(0);
    });
  });

  describe('opponents', () => {
    it('collects opponent ids for A (B from R1, C from R2)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.opponents).toEqual(new Set(['B', 'C']));
    });

    it('does not include bye sentinel as opponent', () => {
      const byeGames: Game[][] = [[{ black: '', result: 1, white: 'A' }]];
      const states = buildPlayerStates([{ id: 'A' }], byeGames);
      expect(states[0]?.opponents.size).toBe(0);
    });
  });

  describe('colorHistory', () => {
    it('records white in R1 and black in R2 for A', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.colorHistory).toEqual(['white', 'black']);
    });

    it('records black in R1 and black in R2 for B', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const b = states.find((s) => s.id === 'B');
      expect(b?.colorHistory).toEqual(['black', 'black']);
    });

    it('returns undefined for rounds where player has no game', () => {
      const partialGames: Game[][] = [
        [{ black: 'B', result: 1, white: 'A' }],
        [{ black: 'D', result: 0, white: 'C' }], // A absent
      ];
      const states = buildPlayerStates(PLAYERS, partialGames);
      const a = states.find((s) => s.id === 'A');
      expect(a?.colorHistory).toEqual(['white', undefined]);
    });

    it('returns undefined for bye rounds', () => {
      const byeGames: Game[][] = [[{ black: '', result: 1, white: 'A' }]];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        byeGames,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.colorHistory).toEqual([undefined]);
    });

    it('returns undefined for forfeit-win rounds', () => {
      const forfeitGames: Game[][] = [
        [
          {
            black: 'B',
            kind: 'forfeit-win',
            result: 1,
            white: 'A',
          },
        ],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        forfeitGames,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.colorHistory).toEqual([undefined]);
      const b = states.find((s) => s.id === 'B');
      expect(b?.colorHistory).toEqual([undefined]);
    });

    it('returns undefined for forfeit-loss rounds', () => {
      const forfeitGames: Game[][] = [
        [
          {
            black: 'B',
            kind: 'forfeit-loss',
            result: 0,
            white: 'A',
          },
        ],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        forfeitGames,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.colorHistory).toEqual([undefined]);
      const b = states.find((s) => s.id === 'B');
      expect(b?.colorHistory).toEqual([undefined]);
    });
  });

  describe('colorDiff', () => {
    it('computes colorDiff as 0 for A (1 white, 1 black)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.colorDiff).toBe(0);
    });

    it('computes colorDiff as -2 for B (0 white, 2 black)', () => {
      // whites - blacks = 0 - 2 = -2
      const states = buildPlayerStates(PLAYERS, GAMES);
      const b = states.find((s) => s.id === 'B');
      expect(b?.colorDiff).toBe(-2);
    });

    it('computes colorDiff as +2 for C (2 white, 0 black)', () => {
      // C: R1 white (C vs D), R2 white (C vs A) → colorDiff = 2-0 = 2
      const states = buildPlayerStates(PLAYERS, GAMES);
      const c = states.find((s) => s.id === 'C');
      expect(c?.colorDiff).toBe(2);
    });
  });

  describe('preferenceStrength', () => {
    it('returns "none" for player with no color history', () => {
      const states = buildPlayerStates([{ id: 'Z' }], []);
      expect(states[0]?.preferenceStrength).toBe('none');
    });

    it('returns "mild" for A (colorDiff=0, has history)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.preferenceStrength).toBe('mild');
    });

    it('returns "absolute" for B (colorDiff=-2, |colorDiff|>1)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const b = states.find((s) => s.id === 'B');
      expect(b?.preferenceStrength).toBe('absolute');
    });

    it('returns "absolute" for C (colorDiff=2, |colorDiff|>1)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const c = states.find((s) => s.id === 'C');
      expect(c?.preferenceStrength).toBe('absolute');
    });

    it('returns "absolute" when last two non-undefined color entries are the same', () => {
      // A plays white in R1 and R2: last two = [white, white]
      const gamesWW: Game[][] = [
        [{ black: 'B', result: 1, white: 'A' }],
        [{ black: 'B', result: 1, white: 'A' }],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        gamesWW,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.preferenceStrength).toBe('absolute');
    });

    it('returns "strong" when |colorDiff|===1', () => {
      const oneWhiteGames: Game[][] = [[{ black: 'B', result: 1, white: 'A' }]];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        oneWhiteGames,
      );
      const a = states.find((s) => s.id === 'A');
      // colorDiff = 1-0 = 1, |colorDiff|===1 → strong
      expect(a?.preferenceStrength).toBe('strong');
    });

    it('returns "none" when only game was a forfeit', () => {
      const games: Game[][] = [
        [{ black: 'B', kind: 'forfeit-win', result: 1, white: 'A' }],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        games,
      );
      expect(states.find((s) => s.id === 'A')?.preferenceStrength).toBe('none');
    });
  });

  describe('preferredColor', () => {
    it('returns undefined for player with no history', () => {
      const states = buildPlayerStates([{ id: 'Z' }], []);
      expect(states[0]?.preferredColor).toBeUndefined();
    });

    it('returns "white" for B (colorDiff=-2, more blacks → prefer white)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const b = states.find((s) => s.id === 'B');
      expect(b?.preferredColor).toBe('white');
    });

    it('returns "black" for C (colorDiff=2, more whites → prefer black)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const c = states.find((s) => s.id === 'C');
      expect(c?.preferredColor).toBe('black');
    });

    it('returns "white" for A (colorDiff=0, last color was black → prefer white)', () => {
      // A: R1 white, R2 black → colorDiff=0, last played black → prefer white
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.preferredColor).toBe('white');
    });

    it('returns undefined when only game was a forfeit', () => {
      const games: Game[][] = [
        [{ black: 'B', kind: 'forfeit-win', result: 1, white: 'A' }],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        games,
      );
      expect(states.find((s) => s.id === 'A')?.preferredColor).toBeUndefined();
    });
  });

  describe('byeCount', () => {
    it('returns 0 when player has no byes', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.byeCount).toBe(0);
    });

    it('returns 1 when player received one bye', () => {
      const byeGames: Game[][] = [[{ black: '', result: 1, white: 'A' }]];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        byeGames,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.byeCount).toBe(1);
    });
  });

  describe('unplayedRounds', () => {
    it('returns 0 for A (played every round)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.unplayedRounds).toBe(0);
    });

    it('returns 1 when player has no game in one round', () => {
      const partialGames: Game[][] = [
        [{ black: 'B', result: 1, white: 'A' }],
        [{ black: 'D', result: 0, white: 'C' }], // A absent
      ];
      const states = buildPlayerStates(PLAYERS, partialGames);
      const a = states.find((s) => s.id === 'A');
      expect(a?.unplayedRounds).toBe(1);
    });

    it('does not count bye rounds as unplayed', () => {
      const byeGames: Game[][] = [[{ black: '', result: 1, white: 'A' }]];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        byeGames,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.unplayedRounds).toBe(0);
    });
  });

  describe('tpn', () => {
    it('assigns 1-indexed positions matching players array order', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      expect(states.find((s) => s.id === 'A')?.tpn).toBe(1);
      expect(states.find((s) => s.id === 'B')?.tpn).toBe(2);
      expect(states.find((s) => s.id === 'C')?.tpn).toBe(3);
      expect(states.find((s) => s.id === 'D')?.tpn).toBe(4);
    });
  });

  describe('floatHistory', () => {
    it('has one entry per round', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.floatHistory).toHaveLength(2);
    });

    it('returns undefined for R1 (both players had 0 score before R1)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.floatHistory[0]).toBeUndefined();
    });

    it('returns "down" for A in R2 (A had 1 point, C had 0 before R2)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const a = states.find((s) => s.id === 'A');
      expect(a?.floatHistory[1]).toBe('down');
    });

    it('returns "up" for C in R2 (C had 0 points, A had 1 before R2)', () => {
      const states = buildPlayerStates(PLAYERS, GAMES);
      const c = states.find((s) => s.id === 'C');
      expect(c?.floatHistory[1]).toBe('up');
    });

    it('returns undefined for rounds with no game', () => {
      const partialGames: Game[][] = [
        [{ black: 'B', result: 1, white: 'A' }],
        [{ black: 'D', result: 0, white: 'C' }], // A absent
      ];
      const states = buildPlayerStates(PLAYERS, partialGames);
      const a = states.find((s) => s.id === 'A');
      expect(a?.floatHistory[1]).toBeUndefined();
    });

    it('returns "down" for bye rounds', () => {
      const byeGames: Game[][] = [[{ black: '', result: 1, white: 'A' }]];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        byeGames,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.floatHistory[0]).toBe('down');
    });

    it('returns "down" for forfeit-win rounds', () => {
      // Player A (score 0) beats B (score 1) by forfeit.
      // bbpPairings: gameWasPlayed=false, points > pointsForLoss → FLOAT_DOWN.
      // Without the fix, score comparison would say A floated UP (0 < 1).
      const r1Games: Game[][] = [
        [
          { black: 'B', result: 0, white: 'A' }, // A loses R1 → A=0, B=1
        ],
      ];
      const r2Games: Game[][] = [
        ...r1Games,
        [
          {
            black: 'B',
            kind: 'forfeit-win',
            result: 1,
            white: 'A',
          },
        ],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        r2Games,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.floatHistory[1]).toBe('down');
    });

    it('returns undefined for forfeit-loss rounds', () => {
      // Player A (score 1) loses to B (score 0) by forfeit.
      // bbpPairings: gameWasPlayed=false, points = pointsForLoss → FLOAT_NONE.
      // Without the fix, score comparison would say A floated DOWN (1 > 0).
      const r1Games: Game[][] = [
        [
          { black: 'B', result: 1, white: 'A' }, // A wins R1 → A=1, B=0
        ],
      ];
      const r2Games: Game[][] = [
        ...r1Games,
        [
          {
            black: 'B',
            kind: 'forfeit-loss',
            result: 0,
            white: 'A',
          },
        ],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        r2Games,
      );
      const a = states.find((s) => s.id === 'A');
      expect(a?.floatHistory[1]).toBeUndefined();
    });

    it('returns undefined for the loser in a forfeit-win game (black side)', () => {
      const r1Games: Game[][] = [
        [
          { black: 'B', result: 0, white: 'A' }, // A loses R1 → A=0, B=1
        ],
      ];
      const r2Games: Game[][] = [
        ...r1Games,
        [
          {
            black: 'B',
            kind: 'forfeit-win',
            result: 1,
            white: 'A',
          },
        ],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        r2Games,
      );
      const b = states.find((s) => s.id === 'B');
      // B is the loser (black side of forfeit-win = white won)
      expect(b?.floatHistory[1]).toBeUndefined();
    });

    it('returns "down" for the winner in a forfeit-loss game (black side)', () => {
      const r1Games: Game[][] = [
        [
          { black: 'B', result: 1, white: 'A' }, // A wins R1 → A=1, B=0
        ],
      ];
      const r2Games: Game[][] = [
        ...r1Games,
        [
          {
            black: 'B',
            kind: 'forfeit-loss',
            result: 0,
            white: 'A',
          },
        ],
      ];
      const states = buildPlayerStates(
        [
          { id: 'A', rating: 2000 },
          { id: 'B', rating: 1900 },
        ],
        r2Games,
      );
      const b = states.find((s) => s.id === 'B');
      // B is the winner (black side of forfeit-loss = white lost)
      expect(b?.floatHistory[1]).toBe('down');
    });
  });
});

describe('scoreGroups', () => {
  it('groups players by score with keys sorted descending', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const groups = scoreGroups(states);
    const keys = [...groups.keys()];
    // After 2 rounds: A=1.5, B=1, C=0.5, D=1 → keys descending: 1.5, 1, 0.5
    expect(keys).toEqual([1.5, 1, 0.5]);
  });

  it('places A alone in the 1.5 group', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const groups = scoreGroups(states);
    const group = groups.get(1.5);
    expect(group).toHaveLength(1);
    expect(group?.[0]?.id).toBe('A');
  });

  it('places B and D in the 1.0 group, ordered by TPN ascending', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const groups = scoreGroups(states);
    const group = groups.get(1);
    expect(group).toHaveLength(2);
    // B has tpn=2, D has tpn=4 → B first
    expect(group?.[0]?.id).toBe('B');
    expect(group?.[1]?.id).toBe('D');
  });

  it('places C alone in the 0.5 group', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    const groups = scoreGroups(states);
    const group = groups.get(0.5);
    expect(group).toHaveLength(1);
    expect(group?.[0]?.id).toBe('C');
  });

  it('returns empty map for no players', () => {
    expect(scoreGroups([])).toEqual(new Map());
  });
});

describe('assignBye', () => {
  it('returns undefined when player count is even', () => {
    const states = buildPlayerStates(PLAYERS, GAMES);
    expect(assignBye(states, GAMES, tiebreakByTpnAsc)).toBeUndefined();
  });

  it('returns a player when count is odd', () => {
    const oddPlayers = PLAYERS.slice(0, 3);
    const oddGames: Game[][] = [
      [
        { black: 'B', result: 1, white: 'A' },
        // C has no opponent in R1
      ],
    ];
    const states = buildPlayerStates(oddPlayers, oddGames);
    const result = assignBye(states, oddGames, tiebreakByTpnAsc);
    expect(result).toBeDefined();
  });

  it('excludes players who already have a bye', () => {
    const threePlayers = [
      { id: 'A', rating: 2000 },
      { id: 'B', rating: 1900 },
      { id: 'C', rating: 1800 },
    ];
    // A already received a bye in R1
    const gamesWithBye: Game[][] = [
      [
        { black: '', result: 1, white: 'A' },
        { black: 'C', result: 1, white: 'B' },
      ],
    ];
    const states = buildPlayerStates(threePlayers, gamesWithBye);
    const result = assignBye(states, gamesWithBye, tiebreakByTpnAsc);
    // A has byeCount=1, so should not be selected if B or C are eligible
    expect(result?.id).not.toBe('A');
  });

  it('uses tiebreak comparator when multiple lowest-score players tied', () => {
    const threePlayers = [
      { id: 'A', rating: 2000 },
      { id: 'B', rating: 1900 },
      { id: 'C', rating: 1800 },
    ];
    const noGames: Game[][] = [];
    const states = buildPlayerStates(threePlayers, noGames);
    // All score 0; tiebreak by TPN descending → highest TPN (C=3) first → gets bye
    const result = assignBye(states, noGames, tiebreakByTpnDesc);
    expect(result?.id).toBe('C');
  });

  it('falls back to all players if none have byeCount===0', () => {
    const threePlayers = [
      { id: 'A', rating: 2000 },
      { id: 'B', rating: 1900 },
      { id: 'C', rating: 1800 },
    ];
    // All players had byes
    const allByeGames: Game[][] = [
      [
        { black: '', result: 1, white: 'A' },
        { black: '', result: 1, white: 'B' },
        { black: '', result: 1, white: 'C' },
      ],
    ];
    const states = buildPlayerStates(threePlayers, allByeGames);
    // All have byeCount=1, so fallback to all players
    const result = assignBye(states, allByeGames, tiebreakByTpnAsc);
    expect(result).toBeDefined();
  });
});

describe('allocateColor', () => {
  it('falls back to HRP-white when no rules match', () => {
    const a = makeState('A', 2, 1);
    const b = makeState('B', 1, 2);
    const result = allocateColor(a, b, [], rankByTpnAsc);
    // A has higher score → HRP. Fallback gives HRP white.
    expect(result.white).toBe('A');
    expect(result.black).toBe('B');
  });

  it('walks rules until one returns a decision', () => {
    const a = makeState('A', 2, 1);
    const b = makeState('B', 1, 2);

    const result = allocateColor(
      a,
      b,
      [ruleContinue, ruleHrpBlack, ruleHrpWhite],
      rankByTpnAsc,
    );
    // ruleHrpBlack is first to decide. HRP is A (higher score).
    expect(result.black).toBe('A');
    expect(result.white).toBe('B');
  });

  it('determines HRP by score: higher score wins', () => {
    const a = makeState('A', 1, 1); // lower score
    const b = makeState('B', 2, 2); // higher score → HRP

    const result = allocateColor(a, b, [ruleHrpWhite], rankByTpnAsc);
    // B is HRP (higher score)
    expect(result.white).toBe('B');
    expect(result.black).toBe('A');
  });

  it('determines HRP by rankCompare when scores are equal', () => {
    const a = makeState('A', 1, 1);
    const b = makeState('B', 1, 2);

    // rankByTpnAsc: a.tpn - b.tpn = 1-2 = -1 → a ranks higher (negative = first arg higher)
    const result = allocateColor(a, b, [ruleHrpWhite], rankByTpnAsc);
    expect(result.white).toBe('A');
    expect(result.black).toBe('B');
  });

  it('stops at first deciding rule and ignores later rules', () => {
    const a = makeState('A', 2, 1);
    const b = makeState('B', 1, 2);

    let laterRuleCalled = false;
    const trackingRule = () => {
      laterRuleCalled = true;
      return 'hrp-black' as const;
    };

    allocateColor(a, b, [ruleHrpWhite, trackingRule], rankByTpnAsc);
    expect(laterRuleCalled).toBe(false);
  });
});
