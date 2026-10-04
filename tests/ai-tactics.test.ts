import { describe, expect, it } from "vitest";
import { chooseAction, type AiObservation } from "../server/ai.ts";
import { HandPlanner } from "../server/ai-planner.ts";
import { shuffled } from "./benchmark_ai.ts";
import { deck } from "../shared/cards.ts";
import { beats, legalMoves } from "../shared/rules.ts";
import type { Card, Difficulty, Play } from "../shared/types.ts";
const cards = (ids: string[]) =>
  ids.map((id) => deck().find((c) => c.id === id)!);
function observation(hands: Card[][], landlord: number): AiObservation {
  const held = new Set(hands.flat().map((c) => c.id));
  return {
    hand: hands[0],
    wildRank: null,
    seat: 0,
    landlord,
    counts: hands.map((h) => h.length),
    trick: null,
    phase: "playing",
    bidStage: "call",
    played: deck().filter((c) => !held.has(c.id)),
    bottom: landlord === 0 ? [] : hands[landlord],
  };
}
function chosen(obs: AiObservation, tier: Difficulty): Play {
  const action = chooseAction(obs, "balanced", tier).action;
  expect(action.type).toBe("play");
  if (action.type !== "play") throw new Error("Expected a lead");
  return legalMoves(obs.hand, obs.wildRank).find(
    (p) =>
      p.kind === action.kind &&
      p.main === action.main &&
      p.cards
        .map((c) => c.id)
        .sort()
        .join() === action.cardIds.slice().sort().join(),
  )!;
}

/** Independent, exhaustive oracle for the small no-wild puzzle below. No beam,
 * heuristic, time limit, or AI sampler: every legal continuation and pass. */
function farmersCanForceWin(
  hands: Card[][],
  turn: number,
  trick: { seat: number; play: Play } | null,
  passes = 0,
  memo = new Map<string, boolean>(),
): boolean {
  if (!hands[1].length) return false;
  if (!hands[0].length || !hands[2].length) return true;
  const key =
    hands
      .map((h) =>
        h
          .map((c) => c.id)
          .sort()
          .join(","),
      )
      .join("/") +
    `:${turn}:${trick ? trick.seat + trick.play.kind + trick.play.main + trick.play.cards.length : "-"}:${passes}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const options: (Play | null)[] = legalMoves(
    hands[turn],
    null,
    trick?.play ?? null,
  );
  if (trick) options.push(null);
  const farmer = turn !== 1;
  for (const play of options) {
    const next = [...hands];
    if (play)
      next[turn] = next[turn].filter(
        (c) => !play.cards.some((p) => p.id === c.id),
      );
    const nextPasses = play ? 0 : passes + 1;
    const outcome = farmersCanForceWin(
      next,
      (turn + 1) % 3,
      nextPasses === 2 ? null : play ? { seat: turn, play } : trick,
      nextPasses === 2 ? 0 : nextPasses,
      memo,
    );
    if (outcome === farmer) {
      memo.set(key, farmer);
      return farmer;
    }
  }
  memo.set(key, !farmer);
  return !farmer;
}

describe("strategic difficulty improvements", () => {
  it("plans two complete groups without destroying a triple to extend a straight", () => {
    const hand = cards(["3S", "4S", "5S", "6S", "7S", "7H", "8S", "8H", "8C"]);
    const plan = new HandPlanner(hand, null, 1000);
    expect(plan.cost(hand)).toBe(2); // 34567, 888+7; greedy longest straight takes three turns.
    const left = cards(["7H", "8S", "8H", "8C"]);
    expect(plan.cost(left)).toBe(1);
  });
  it("uses wildcard-aware partitions in both wildcard modes", () => {
    const hand = cards(["3S", "4S", "5S", "6S", "9H"]);
    expect(new HandPlanner(hand, null, 1000).cost(hand)).toBeGreaterThan(4);
    expect(new HandPlanner(hand, 9, 1000).cost(hand)).toBe(1);
    expect(new HandPlanner(hand, [9, 10], 1000).cost(hand)).toBe(1);
  });
  it("spends the rocket to keep control and finish instead of feeding a one-card enemy", () => {
    const hands = [
      cards(["3S", "16J", "17J"]),
      cards(["14S"]),
      cards(["4C", "4D"]),
    ];
    const obs = observation(hands, 0);
    expect(chosen(obs, "dazed").kind).toBe("single");
    for (const tier of ["gentle", "fierce"] as const) {
      const play = chosen(obs, tier);
      expect(play.kind).toBe("rocket");
      expect(
        hands
          .slice(1)
          .every((h) => legalMoves(h).every((p) => !beats(p, play))),
      ).toBe(true);
      expect(hands[0].filter((c) => !play.cards.includes(c))).toHaveLength(1);
    }
  });
  it("finds the multi-turn cooperative endgame that gentle's immediate evaluation misses", () => {
    const hands = [
      cards(["11H", "7C", "13D", "9H", "6S", "3H"]),
      cards(["4C", "15D", "6H"]),
      cards(["3S", "14S", "7S", "10H"]),
    ];
    // Landlord's three remaining cards are the public bottom. Everything else has
    // been played or is ours: the partner's hand is deducible without private input.
    const obs = observation(hands, 1);
    const outcome = (tier: Difficulty) => {
      const play = chosen(obs, tier);
      const next = [...hands];
      next[0] = next[0].filter((c) => !play.cards.some((p) => p.id === c.id));
      return farmersCanForceWin(next, 1, { seat: 0, play });
    };
    expect(outcome("gentle")).toBe(false);
    expect(outcome("fierce")).toBe(true);
  });
  it("retains distinct cautious, balanced and bold risk profiles in both new tiers", () => {
    for (const tier of ["gentle", "fierce"] as const) {
      const series: Record<string, boolean[]> = {
        cautious: [],
        balanced: [],
        bold: [],
      };
      for (let seed = 1; seed <= 30; seed++) {
        const obs: AiObservation = {
          hand: shuffled(seed * 691).slice(0, 17),
          wildRank: null,
          seat: 0,
          landlord: -1,
          counts: [17, 17, 17],
          trick: null,
          phase: "bidding",
          bidStage: "call",
          played: [],
          bottom: [],
        };
        for (const personality of ["cautious", "balanced", "bold"] as const) {
          const action = chooseAction(obs, personality, tier).action;
          expect(action.type).toBe("bid");
          if (action.type === "bid") series[personality].push(action.yes);
        }
      }
      const willingness = Object.values(series).map(
        (actions) => actions.filter(Boolean).length,
      );
      expect(willingness[0]).toBeLessThan(willingness[1]);
      expect(willingness[1]).toBeLessThan(willingness[2]);
    }
  });
});
