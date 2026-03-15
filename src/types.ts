type Result = 0 | 0.5 | 1;

interface Bye {
  playerId: string;
}

interface Game {
  blackId: string;
  result: Result;
  round: number;
  whiteId: string;
}

interface Pairing {
  blackId: string;
  whiteId: string;
}

interface PairingResult {
  byes: Bye[];
  pairings: Pairing[];
}

interface Player {
  id: string;
  rating?: number;
}

interface Standing {
  playerId: string;
  rank: number;
  score: number;
  tiebreaks: number[];
}

type Tiebreak = (playerId: string, players: Player[], games: Game[]) => number;

export type {
  Bye,
  Game,
  Pairing,
  PairingResult,
  Player,
  Result,
  Standing,
  Tiebreak,
};
