import { describe, expect, it } from "vitest";
import { chooseAction, type AiObservation } from "../server/ai.ts";
import { deck } from "../shared/cards.ts";
import { applyAction, createGame } from "../shared/engine.ts";
import { beats, interpret, legalMoves } from "../shared/rules.ts";
import type {
  Card,
  GameState,
  Mode,
  Personality,
  Play,
} from "../shared/types.ts";

const personalities: Personality[] = ["cautious", "balanced", "bold"];
const cards = (ids: string[]) =>
  ids.map((id) => deck().find((c) => c.id === id)!);
const example = (overrides: Partial<AiObservation> = {}): AiObservation => ({
  hand: cards(["3S", "3H", "4S", "5S", "6S", "7S", "8S", "16J"]),
  wildRank: null,
  seat: 0,
  landlord: 0,
  counts: [8, 7, 7],
  trick: null,
  phase: "playing",
  bidStage: "call",
  played: [],
  bottom: [],
  ...overrides,
});

function observed(g: GameState, seat: number): AiObservation {
  return {
    hand: g.hands[seat],
    wildRank: g.wildRank,
    seat,
    landlord: g.landlord,
    counts: g.hands.map((h) => h.length),
    trick: g.trick,
    phase: g.phase as AiObservation["phase"],
    bidStage: g.bidding.stage,
    played: g.events.flatMap((e) => e.play?.cards ?? []),
    bottom: g.landlord < 0 ? [] : g.bottom,
  };
}

function shuffle(seed: number): Card[] {
  let x = seed | 0;
  const random = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
  const out = deck();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("computer opponent", () => {
  it("uses public observation and returns only legal lead and response actions", () => {
    for (const personality of personalities) {
      const lead = example();
      expect("hands" in lead).toBe(false);
      const chosen = chooseAction(lead, personality).action;
      expect(chosen.type).toBe("play");
      if (chosen.type === "play") {
        const selected = chosen.cardIds.map((id) =>
          lead.hand.find((c) => c.id === id)!,
        );
        expect(selected.every(Boolean)).toBe(true);
        expect(interpret(selected, null, chosen.as).length).toBeGreaterThan(0);
      }
      const previous: Play = interpret(cards(["3C"]), null)[0];
      const response = chooseAction(
        example({ trick: { seat: 1, play: previous } }),
        personality,
      ).action;
      if (response.type === "play") {
        const selected = response.cardIds.map((id) =>
          lead.hand.find((c) => c.id === id)!,
        );
        expect(
          interpret(selected, null, response.as).some((p) =>
            beats(p, previous),
          ),
        ).toBe(true);
      } else expect(response.type).toBe("pass");
    }
  });

  it("retains explicit wildcard assignments that the engine accepts", () => {
    const previous = interpret(cards(["5C", "5D"]), 7)[0];
    const obs = example({
      hand: cards(["6S", "7S"]),
      wildRank: 7,
      counts: [2, 6, 6],
      trick: { seat: 1, play: previous },
    });
    for (const personality of personalities) {
      const action = chooseAction(obs, personality).action;
      expect(action.type).toBe("play");
      if (action.type !== "play") continue;
      const selected = action.cardIds.map((id) =>
        obs.hand.find((c) => c.id === id)!,
      );
      expect(action.as).toHaveLength(selected.length);
      expect(action.as).toEqual([6, 6]);
      expect(
        interpret(selected, 7, action.as).some((p) => beats(p, previous)),
      ).toBe(true);
    }
  });

  it("lets a farmer partner keep the lead when the landlord has room to play", () => {
    const previous = interpret(cards(["3C"]), null)[0];
    const obs = example({
      seat: 0,
      landlord: 2,
      counts: [8, 6, 9],
      trick: { seat: 1, play: previous },
    });
    for (const personality of personalities)
      expect(chooseAction(obs, personality).action).toEqual({ type: "pass" });
  });

  it("makes different risk choices without changing its observation or search limits", () => {
    const hand = cards([
      "16J",
      "15S",
      "15H",
      "14S",
      "13S",
      "12S",
      "11S",
      "10S",
      "9S",
      "8S",
      "7S",
      "6S",
      "5S",
      "4S",
      "3S",
      "3H",
      "4H",
    ]);
    const obs = example({
      hand,
      phase: "bidding",
      landlord: -1,
      counts: [17, 17, 17],
    });
    expect(chooseAction(obs, "cautious").action).toEqual({
      type: "bid",
      yes: false,
    });
    expect(chooseAction(obs, "balanced").action).toEqual({
      type: "bid",
      yes: true,
    });
    expect(chooseAction(obs, "bold").action).toEqual({
      type: "bid",
      yes: true,
    });
  });

  it("can choose different legal leads with the same hand and public information", () => {
    const hand = cards([
      "3S",
      "14C",
      "10C",
      "4H",
      "14S",
      "15D",
      "7S",
      "5S",
      "8C",
      "7H",
      "8S",
      "17J",
      "3C",
      "10H",
      "6C",
      "5D",
      "9S",
    ]);
    const obs = example({ hand, counts: [17, 17, 17] });
    const cautious = chooseAction(obs, "cautious").action;
    const bold = chooseAction(obs, "bold").action;
    expect(cautious.type).toBe("play");
    expect(bold.type).toBe("play");
    if (cautious.type !== "play" || bold.type !== "play") return;
    expect(cautious.cardIds).not.toEqual(bold.cardIds);
    for (const action of [cautious, bold]) {
      const selected = action.cardIds.map((id) =>
        hand.find((c) => c.id === id)!,
      );
      expect(interpret(selected, null, action.as).length).toBeGreaterThan(0);
    }
  });

  it("takes a winning wild move even when it appears beyond the scoring cap", () => {
    const hand = deck().filter(
      (c) => c.rank >= 3 && c.rank <= 12 && (c.suit === "S" || c.suit === "H"),
    );
    const moves = legalMoves(hand, 7);
    expect(
      moves.findIndex((p) => p.cards.length === hand.length),
    ).toBeGreaterThan(320);
    const obs = example({ hand, wildRank: 7, counts: [20, 17, 17] });
    for (const personality of personalities) {
      const action = chooseAction(obs, personality).action;
      expect(action.type).toBe("play");
      if (action.type === "play") {
        expect(action.cardIds).toHaveLength(20);
        const selected = action.cardIds.map((id) =>
          hand.find((c) => c.id === id)!,
        );
        expect(interpret(selected, 7, action.as).length).toBeGreaterThan(0);
      }
    }
  });

  it("completes six seeded standard and wild games through the engine", () => {
    let completed = 0,
      decisions = 0,
      largestDecisionMs = 0;
    for (const mode of ["standard", "wild"] as Mode[]) {
      for (let match = 0; match < 3; match++) {
        let g = createGame(
          `${mode}-${match}`,
          mode,
          shuffle(7100 + match * 83 + (mode === "wild" ? 401 : 0)),
          match,
          mode === "wild" ? 7 + match : null,
        );
        // All-pass deals are replayed with the next deterministic shuffle.
        for (let redeals = 0; g.phase === "redeal" && redeals < 10; redeals++)
          g = createGame(
            `${mode}-${match}-${redeals}`,
            mode,
            shuffle(9000 + redeals + match * 19),
            match,
            mode === "wild" ? 7 + match : null,
          );
        let steps = 0;
        while (g.phase !== "finished" && steps < 220) {
          if (g.phase === "redeal") {
            g = createGame(
              `${mode}-${match}-redo-${steps}`,
              mode,
              shuffle(12000 + steps + match * 47),
              match,
              mode === "wild" ? 7 + match : null,
            );
            continue;
          }
          const seat =
            g.phase === "doubling"
              ? g.doubles.findIndex((v) => v === null)
              : g.turn;
          const obs = observed(g, seat);
          const started = performance.now();
          const choice = chooseAction(obs, personalities[seat]);
          largestDecisionMs = Math.max(
            largestDecisionMs,
            performance.now() - started,
          );
          expect(choice.explanation.length).toBeGreaterThan(0);
          if (g.phase === "playing" && (!g.trick || g.trick.seat === seat))
            expect(choice.action.type).toBe("play");
          g = applyAction(g, seat, choice.action);
          decisions++;
          steps++;
        }
        expect(g.phase).toBe("finished");
        expect(g.winner === "farmers" || g.winner === "landlord").toBe(true);
        completed++;
      }
    }
    expect(completed).toBe(6);
    expect(decisions).toBeGreaterThan(60);
    expect(largestDecisionMs).toBeLessThan(200);
  }, 30_000);
});
