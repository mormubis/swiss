/**
 * @internal
 * Shared helpers for single-pass blossom-based pairing systems
 * (Dubov, Burstein, Lim).
 *
 * Provides `buildBlossomEdges` and `runBlossom` — the two steps that are
 * identical across all single-pass systems except for the criteria array,
 * context, and system tag used in trace events.
 */
import { maxWeightMatching } from './blossom.js';
import { buildEdgeWeight } from './weights.js';

import type { DynamicUint } from './dynamic-uint.js';
import type { TraceCallback } from './trace.js';
import type { PlayerState } from './utilities.js';
import type { BracketContext, Criterion } from './weights.js';

/**
 * Build a complete graph for a set of players.
 * Returns [indexA, indexB, weight] tuples for maxWeightMatching.
 * Edges with zero weight (C1 rematches) are omitted so that
 * maxcardinality mode never forces a rematch.
 */
function buildBlossomEdges(
  players: PlayerState[],
  criteria: Criterion[],
  context: BracketContext,
): [number, number, DynamicUint][] {
  const edges: [number, number, DynamicUint][] = [];
  for (let index = 0; index < players.length; index++) {
    for (let index_ = index + 1; index_ < players.length; index_++) {
      const a = players.at(index);
      const b = players.at(index_);
      if (a === undefined || b === undefined) continue;
      const weight = buildEdgeWeight(criteria, a, b, context);
      if (!weight.isZero()) {
        edges.push([index, index_, weight]);
      }
    }
  }
  return edges;
}

/**
 * Run blossom on edges and return a Map<id, id> of matched pairs.
 */
function runBlossom(
  players: PlayerState[],
  edges: [number, number, DynamicUint][],
  system: string,
  maxcardinality = true,
  trace?: TraceCallback,
): Map<string, string> {
  if (players.length === 0) return new Map();
  if (trace) {
    trace({
      edgeCount: edges.length,
      phase: 'main',
      system,
      type: 'pairing:blossom-invoked',
      vertexCount: players.length,
    });
  }
  const matching = maxWeightMatching(edges, maxcardinality, trace);
  const result = new Map<string, string>();
  for (const [index, index_] of matching.entries()) {
    if (index_ !== undefined && index_ !== -1 && index_ > index) {
      const a = players.at(index);
      const b = players.at(index_);
      if (a === undefined || b === undefined) continue;
      result.set(a.id, b.id);
      result.set(b.id, a.id);
    }
  }
  if (trace) {
    const pairs: [string, string][] = [];
    for (const [a, b] of result) {
      if (a < b) pairs.push([a, b]);
    }
    trace({
      pairs,
      phase: 'main',
      system,
      type: 'pairing:blossom-result',
      unmatchedCount: players.length - pairs.length * 2,
    });
  }
  return result;
}

export { buildBlossomEdges, runBlossom };
