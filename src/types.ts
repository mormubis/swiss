type Result = 0 | 0.5 | 1;

interface Bye {
  player: string;
}

interface Game {
  black: string;
  result: Result;
  white: string;
}

interface Pairing {
  black: string;
  white: string;
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
