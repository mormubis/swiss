/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Weight encoding for FIDE Swiss pairing criteria.
 *
 * Converts a priority-ordered list of pairing criteria into a DynamicUint
 * edge weight suitable for use with the blossom maximum-weight matching
 * algorithm.
 *
 * @internal Not part of the public API.
 */
import { DynamicUint } from './dynamic-uint.js';

import type { PlayerState } from './utilities.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context describing the current bracket/round structure, passed to dynamic
 * criteria so they can compute bit widths or evaluate based on tournament
 * state.
 */
interface BracketContext {
  byeAssigneeScore: number;
  isSingleDownfloaterTheByeAssignee: boolean;
  scoreGroupShifts: Map<number, number>;
  scoreGroupSizeBits: number;
  scoreGroupsShift: number;
  tournament: { expectedRounds: number; playedRounds: number };
}

/**
 * A single pairing criterion. Carries both a bit-width declaration and an
 * evaluation function that returns a non-negative integer fitting within that
 * width.
 */
interface Criterion {
  bits: number | ((context: BracketContext) => number);
  evaluate: (a: PlayerState, b: PlayerState, context: BracketContext) => number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves `Criterion.bits` to a concrete number.
 */
function resolveBits(bits: Criterion['bits'], context: BracketContext): number {
  return typeof bits === 'function' ? bits(context) : bits;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Builds an edge weight for a pair of players given a priority-ordered list
 * of criteria. `criteria[0]` is the highest-priority criterion and occupies
 * the most significant bits of the result.
 *
 * Returns `DynamicUint.from(0)` when the two players have already faced each
 * other (C1 — no rematches).
 */
function buildEdgeWeight(
  criteria: Criterion[],
  a: PlayerState,
  b: PlayerState,
  context: BracketContext,
): DynamicUint {
  if (a.opponents.has(b.id)) {
    return DynamicUint.from(0);
  }

  const result = DynamicUint.from(0);
  for (const [index, criterion_] of criteria.entries()) {
    const criterion = criterion_!;
    const bits = resolveBits(criterion.bits, context);
    if (index > 0) {
      result.shiftGrow(bits);
    }
    result.or(criterion.evaluate(a, b, context));
  }
  return result;
}

/**
 * Computes an upper bound on any possible edge weight for the given criteria
 * list and context. Each criterion slot is filled with its maximum possible
 * value `(1 << bits) - 1`.
 */
function computeMaxWeight(
  criteria: Criterion[],
  context: BracketContext,
): DynamicUint {
  const result = DynamicUint.from(0);
  for (const [index, criterion] of criteria.entries()) {
    const bits = resolveBits(criterion!.bits, context);
    if (index > 0) {
      result.shiftGrow(bits);
    }
    result.or(bits < 32 ? (1 << bits) - 1 : 0xff_ff_ff_ff);
  }
  return result;
}

export { buildEdgeWeight, computeMaxWeight };
export type { BracketContext, Criterion };
