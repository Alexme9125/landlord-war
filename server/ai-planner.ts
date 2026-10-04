import type { Card, Play, Wildcards } from "../shared/types.ts";
import { legalMoves } from "../shared/rules.ts";

export const rankCounts = (hand: Card[]) => {
  const counts = Array<number>(15).fill(0);
  for (const c of hand) counts[c.rank - 3]++;
  return counts;
};
const weights = Array.from({ length: 15 }, (_, i) => 5 ** i);
const keyOf = (counts: number[]) =>
  counts.reduce((sum, n, i) => sum + n * weights[i], 0);

/** A cheap leaf evaluation, not the new AI's hand partition search. */
export function roughTurns(hand: Card[]): number {
  const c = rankCounts(hand);
  let turns = 0;
  for (const [unit, minimum] of [
    [3, 2],
    [2, 3],
    [1, 5],
  ]) {
    for (let start = 0; start < 12; start++) {
      if (c[start] < unit) continue;
      let end = start;
      while (end + 1 < 12 && c[end + 1] >= unit) end++;
      if (end - start + 1 >= minimum) {
        for (let i = start; i <= end; i++) c[i] -= unit;
        turns++;
        start = -1;
      } else start = end;
    }
  }
  let triples = 0,
    wings = 0;
  for (const n of c) {
    if (n) turns++;
    if (n === 3) triples++;
    else if (n === 1 || n === 2) wings++;
  }
  return turns - Math.min(triples, wings) - Number(c[13] > 0 && c[14] > 0);
}

type Pattern = { counts: number[]; key: number; size: number; cost: number };

/**
 * Bounded, memoized rank-multiset partitioning. Rank counts (not physical-card
 * masks) let two disjoint pairs of the same rank both occur in a plan. Wildcard
 * consumption comes from validated plays, including both heaven/earth ranks.
 * The move generator bounds wings; this is a practical plan, not an optimality proof.
 */
export class HandPlanner {
  readonly moves: Play[];
  private patterns: Pattern[];
  private byRank: Pattern[][];
  private memo = new Map<number, number>([[0, 0]]);
  private nodes = 0;
  constructor(
    hand: Card[],
    wild: Wildcards,
    private budget: number,
    private deadline = Infinity,
    moves?: Play[],
  ) {
    this.moves = moves ?? legalMoves(hand, wild);
    const unique = new Map<number, Pattern>();
    for (const move of this.moves) {
      const counts = rankCounts(move.cards),
        key = keyOf(counts);
      const cost =
        1 +
        (move.kind === "single" && move.main < 13
          ? 0.13
          : move.kind === "pair" && move.main < 10
            ? 0.06
            : 0);
      if (!unique.has(key) || unique.get(key)!.cost > cost)
        unique.set(key, { counts, key, size: move.cards.length, cost });
    }
    this.patterns = [...unique.values()].sort(
      (a, b) => b.size - a.size || a.cost - b.cost || a.key - b.key,
    );
    this.byRank = Array.from({ length: 15 }, (_, i) =>
      this.patterns.filter((p) => p.counts[i]),
    );
  }
  cost(hand: Card[]) {
    return this.solve(rankCounts(hand));
  }
  private fits(p: Pattern, counts: number[]) {
    return p.counts.every((n, i) => n <= counts[i]);
  }
  private greedy(counts: number[]): number {
    const remaining = [...counts];
    let value = 0;
    for (const p of this.patterns) {
      while (this.fits(p, remaining)) {
        p.counts.forEach((n, i) => (remaining[i] -= n));
        value += p.cost;
      }
    }
    return value;
  }
  private solve(counts: number[]): number {
    const key = keyOf(counts),
      cached = this.memo.get(key);
    if (cached !== undefined) return cached;
    let best = this.greedy(counts);
    // All candidate residuals get a legal greedy plan even after the search budget.
    if (++this.nodes > this.budget || performance.now() >= this.deadline) {
      this.memo.set(key, best);
      return best;
    }
    const pivot = counts.findIndex((n) => n > 0);
    const size = counts.reduce((s, n) => s + n, 0);
    let examined = 0;
    for (const p of this.byRank[pivot]) {
      if (!this.fits(p, counts)) continue;
      if (p.size === size) {
        best = Math.min(best, p.cost);
        break;
      }
      if (++examined > 36 || best <= 2) break;
      const rest = counts.map((n, i) => n - p.counts[i]);
      best = Math.min(best, p.cost + this.solve(rest));
    }
    this.memo.set(key, best);
    return best;
  }
}
