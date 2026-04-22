/**
 * Structured trace events for pairing algorithm observability.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Blossom algorithm events
// ---------------------------------------------------------------------------

interface BlossomStageStart {
  stage: number;
  type: 'blossom:stage-start';
  unmatchedCount: number;
  vertexCount: number;
}

interface BlossomAugmentingPath {
  edgeIndex: number;
  type: 'blossom:augmenting-path';
  vertices: number[];
}

interface BlossomFormed {
  base: number;
  blossomIndex: number;
  childCount: number;
  type: 'blossom:formed';
}

interface BlossomExpanded {
  blossomIndex: number;
  childCount: number;
  endstage: boolean;
  type: 'blossom:expanded';
}

interface BlossomDualUpdate {
  delta: string;
  type: 'blossom:dual-update';
}

interface BlossomDelta {
  deltaType: number;
  deltaValue: string;
  type: 'blossom:delta';
}

interface BlossomComplete {
  matchedCount: number;
  type: 'blossom:complete';
  vertexCount: number;
}

// ---------------------------------------------------------------------------
// Pairing system events (shared structure)
// ---------------------------------------------------------------------------

interface ScoreGroupsComputed {
  groups: { playerIds: string[]; score: number }[];
  system: string;
  type: 'pairing:score-groups';
}

interface ByeAssigned {
  playerId: string;
  reason: string;
  system: string;
  type: 'pairing:bye-assigned';
}

interface BlossomInvoked {
  edgeCount: number;
  phase: string;
  system: string;
  type: 'pairing:blossom-invoked';
  vertexCount: number;
}

interface BlossomResult {
  pairs: [string, string][];
  phase: string;
  system: string;
  type: 'pairing:blossom-result';
  unmatchedCount: number;
}

interface EdgeWeightsComputed {
  edges: {
    criteria: Record<string, number>;
    playerA: string;
    playerB: string;
    weight: string;
  }[];
  phase: string;
  system: string;
  type: 'pairing:edge-weights';
}

interface PairFinalized {
  phase: string;
  playerA: string;
  playerB: string;
  system: string;
  type: 'pairing:pair-finalized';
}

interface ColorAllocated {
  black: string;
  rule: string;
  system: string;
  type: 'pairing:color-allocated';
  white: string;
}

// ---------------------------------------------------------------------------
// Dutch-specific events
// ---------------------------------------------------------------------------

interface DutchBracketEnter {
  bracketScore: number;
  mdpIds: string[];
  playerIds: string[];
  type: 'dutch:bracket-enter';
}

interface DutchMdpSelected {
  playerId: string;
  sourceScore: number;
  targetScore: number;
  type: 'dutch:mdp-selected';
}

interface DutchWeightBoost {
  newWeight: string;
  oldWeight: string;
  playerA: string;
  playerB: string;
  reason: string;
  type: 'dutch:weight-boost';
}

interface DutchFallback {
  phase: 'bracket-fallback' | 'global-fallback';
  remainingCount: number;
  type: 'dutch:fallback';
}

// ---------------------------------------------------------------------------
// Union and callback
// ---------------------------------------------------------------------------

type BlossomTraceEvent =
  | BlossomAugmentingPath
  | BlossomComplete
  | BlossomDelta
  | BlossomDualUpdate
  | BlossomExpanded
  | BlossomFormed
  | BlossomStageStart;

type PairingTraceEvent =
  | BlossomInvoked
  | BlossomResult
  | ByeAssigned
  | ColorAllocated
  | DutchBracketEnter
  | DutchFallback
  | DutchMdpSelected
  | DutchWeightBoost
  | EdgeWeightsComputed
  | PairFinalized
  | ScoreGroupsComputed;

type TraceEvent = BlossomTraceEvent | PairingTraceEvent;

type TraceCallback = (event: TraceEvent) => void;

interface PairOptions {
  expectedRounds?: number;
  trace?: TraceCallback;
}

export type {
  BlossomTraceEvent,
  PairOptions,
  PairingTraceEvent,
  TraceCallback,
  TraceEvent,
};
