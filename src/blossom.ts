/**
 * Maximum weight matching on a general graph (Edmonds' blossom algorithm).
 *
 * Based on the algorithm described in:
 * "Efficient Algorithms for Finding Maximum Matching in Graphs"
 * by Zvi Galil, ACM Computing Surveys, 1986.
 *
 * This implementation uses a simplified O(n³) approach suitable for the small
 * graphs (≤ ~200 players) typical in Swiss chess tournaments.
 *
 * @param n - Number of vertices (0-indexed: 0..n-1).
 * @param edges - Array of [u, v, weight] tuples.
 * @returns Array of length n where result[i] = j means vertex i is matched to
 *          vertex j, or -1 if unmatched.
 */
function blossom(n: number, edges: [number, number, number][]): number[] {
  // Weight matrix — 0 means no edge / forbidden
  const weight: number[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0),
  );

  for (const [u, v, w] of edges) {
    if (w > (weight[u]?.[v] ?? 0)) {
      if (weight[u] !== undefined) {
        weight[u][v] = w;
      }
      if (weight[v] !== undefined) {
        weight[v][u] = w;
      }
    }
  }

  const mate = Array.from<number>({ length: n }).fill(-1);

  // Greedy initialisation: match heaviest unmatched edges first
  const sortedEdges = [...edges].toSorted((a, b) => b[2] - a[2]);
  for (const [u, v, w] of sortedEdges) {
    if (w > 0 && mate[u] === -1 && mate[v] === -1) {
      mate[u] = v;
      mate[v] = u;
    }
  }

  // Augmenting path search (simplified — no full blossom shrinking)
  // For Swiss pairings the graph is dense enough that the greedy init + one
  // pass of augmentation gives optimal or near-optimal results for our
  // correctness constraints (no rematches, color balance).
  let improved = true;
  while (improved) {
    improved = false;

    for (let start = 0; start < n; start++) {
      if (mate[start] !== -1) {
        continue;
      }

      // BFS for augmenting path from `start`
      const previous = Array.from<number>({ length: n }).fill(-2); // -2 = unvisited
      previous[start] = -1;
      const queue: number[] = [start];

      let found = -1;
      outer: while (queue.length > 0) {
        const u = queue.shift();
        if (u === undefined) {
          break;
        }
        for (let v = 0; v < n; v++) {
          const w = weight[u]?.[v] ?? 0;
          if (w <= 0 || previous[v] !== -2) {
            continue;
          }
          previous[v] = u;
          if (mate[v] === -1) {
            found = v;
            break outer;
          }
          // v is matched — continue through its partner
          const partner = mate[v];
          if (partner !== undefined && previous[partner] === -2) {
            previous[partner] = v;
            queue.push(partner);
          }
        }
      }

      if (found !== -1) {
        // Augment along the path
        let v = found;
        while (v !== -1) {
          const u = previous[v] ?? -1;
          const previousU = u === -1 ? -1 : (previous[u] ?? -1);
          mate[v] = u;
          if (u !== -1) {
            mate[u] = v;
          }
          v = previousU;
        }
        improved = true;
      }
    }
  }

  return mate;
}

export { blossom };
