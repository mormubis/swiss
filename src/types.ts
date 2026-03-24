type Result = 0 | 0.5 | 1;

interface Bye {
  playerId: string;
}

interface Game {
  blackId: string;
  result: Result;
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

export type { Bye, Game, Pairing, PairingResult, Player, Result };
