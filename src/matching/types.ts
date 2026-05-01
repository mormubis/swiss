/**
 * Label enum for blossom labels used during augmentation.
 *
 * Ported from bbpPairings vertex labelling conventions.
 *
 * @internal Not part of the public API.
 */
enum Label {
  /** Exposed vertex with positive dual — root of alternating tree. */
  OUTER = 0,
  /** Exposed vertex with zero dual — can augment via zero-resistance edge. */
  ZERO = 1,
  /** Matched vertex in alternating tree at odd depth. */
  INNER = 2,
  /** Matched vertex not yet reached by alternating tree. */
  FREE = 3,
}

export { Label };
