import { describe, expect, it } from "vitest";
import { chooseAction, type AiObservation } from "../server/ai.ts";
import { deck, gameWildRanks } from "../shared/cards.ts";
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
  // The earth rank is hidden until a landlord has been chosen.
  const wildRank =
    g.mode === "heaven-earth"
      ? g.landlord < 0
        ? g.heavenRank === null
          ? []
          : [g.heavenRank]
        : gameWildRanks(g)
      : g.wildRank;
  return {
    hand: g.hands[seat],
    wildRank,
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
        expect(
          interpret(selected, null, chosen.as).some(
            (p) => p.kind === chosen.kind && p.main === chosen.main,
          ),
        ).toBe(true);
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
          interpret(selected, null, response.as).some(
            (p) =>
              p.kind === response.kind &&
              p.main === response.main &&
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
        interpret(selected, 7, action.as).some(
          (p) =>
            p.kind === action.kind &&
            p.main === action.main &&
            beats(p, previous),
        ),
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

  it("keeps the earth rank out of bidding observations until landlord assignment", () => {
    const g = createGame("hidden-earth", "heaven-earth", deck(), 0, 7, 10, 8);
    g.hands[0] = cards(["7S", "7H", "7C", "7D", "14S"]);
    expect(observed(g, 0).wildRank).toEqual([8]);
    expect(chooseAction(observed(g, 0), "balanced").action).toEqual({
      type: "bid",
      yes: false,
    });
    g.landlord = 0;
    expect(observed(g, 0).wildRank).toEqual([8, 7]);
    expect(chooseAction(observed(g, 0), "balanced").action).toEqual({
      type: "bid",
      yes: true,
    });
  });

  it("uses the full eight-card mixed bomb to win over a seven-card bomb", () => {
    const wild = [7, 8];
    const hand = cards(["7S", "7H", "7C", "7D", "8S", "8H", "8C", "8D"]);
    const previous = interpret(hand.slice(0, 7), wild).find(
      (p) => p.kind === "mixedWildBomb",
    )!;
    expect(previous).toBeDefined();
    const obs = example({
      hand,
      wildRank: wild,
      counts: [8, 2, 5],
      trick: { seat: 1, play: previous },
    });
    for (const personality of personalities) {
      const action = chooseAction(obs, personality).action;
      expect(action.type).toBe("play");
      if (action.type !== "play") continue;
      expect(action.cardIds).toHaveLength(8);
      expect(action.as).toHaveLength(8);
      expect(action.kind).toBe("mixedWildBomb");
      const selected = action.cardIds.map((id) =>
        hand.find((c) => c.id === id)!,
      );
      expect(
        interpret(selected, wild, action.as).some(
          (p) =>
            p.kind === action.kind &&
            p.main === action.main &&
            beats(p, previous),
        ),
      ).toBe(true);
    }
  });

  it("responds with the only legal long bomb and keeps its explicit assignment", () => {
    const wild = [7, 8];
    const hand = cards(["7S", "7H", "7C", "7D", "8S", "8H", "8C", "8D", "16J"]);
    const previous = interpret(hand.slice(0, 7), wild).find(
      (p) => p.kind === "mixedWildBomb",
    )!;
    const obs = example({
      hand,
      wildRank: wild,
      seat: 0,
      landlord: 1,
      counts: [9, 2, 5],
      trick: { seat: 1, play: previous },
    });
    const moves = legalMoves(hand, wild, previous);
    expect(moves).toHaveLength(1);
    for (const personality of personalities) {
      const action = chooseAction(obs, personality).action;
      expect(action.type).toBe("play");
      if (action.type !== "play") continue;
      expect(action.kind).toBe("mixedWildBomb");
      expect(action.as).toHaveLength(8);
      const selected = action.cardIds.map((id) =>
        hand.find((c) => c.id === id)!,
      );
      expect(
        interpret(selected, wild, action.as).some(
          (p) =>
            p.kind === action.kind &&
            p.main === action.main &&
            beats(p, previous),
        ),
      ).toBe(true);
    }
  });

  it("bounds an eight-wildcard decision with thousands of candidates", () => {
    const hand = deck().filter(
      (c) =>
        c.rank === 7 ||
        c.rank === 8 ||
        ([3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15].includes(c.rank) &&
          c.suit === "S") ||
        (c.rank === 3 && c.suit === "H"),
    );
    const wild = [7, 8];
    expect(hand).toHaveLength(20);
    expect(legalMoves(hand, wild).length).toBeGreaterThan(320);
    const obs = example({ hand, wildRank: wild, counts: [20, 17, 17] });
    const started = performance.now();
    const action = chooseAction(obs, "balanced").action;
    expect(performance.now() - started).toBeLessThan(1000);
    expect(action.type).toBe("play");
    if (action.type !== "play") return;
    const selected = action.cardIds.map((id) => hand.find((c) => c.id === id)!);
    expect(action.as).toHaveLength(selected.length);
    expect(
      interpret(selected, wild, action.as).some(
        (p) => p.kind === action.kind && p.main === action.main,
      ),
    ).toBe(true);
  });

  it("finds an eight-wildcard finish beyond the 320-candidate scoring cap", () => {
    const hand = deck().filter(
      (c) =>
        c.rank === 7 ||
        c.rank === 8 ||
        ([6, 10, 11, 14].includes(c.rank) && c.suit !== "D"),
    );
    const wild = [7, 8];
    const moves = legalMoves(hand, wild);
    expect(
      moves.findIndex((p) => p.cards.length === hand.length),
    ).toBeGreaterThan(320);
    const obs = example({ hand, wildRank: wild, counts: [20, 17, 17] });
    for (const personality of personalities) {
      const action = chooseAction(obs, personality).action;
      expect(action.type).toBe("play");
      if (action.type !== "play") continue;
      expect(action.cardIds).toHaveLength(20);
      const selected = action.cardIds.map((id) =>
        hand.find((c) => c.id === id)!,
      );
      expect(
        interpret(selected, wild, action.as).some(
          (p) => p.kind === action.kind && p.main === action.main,
        ),
      ).toBe(true);
      const g = createGame("long-finish", "heaven-earth", deck(), 0, 7, 10, 8);
      g.phase = "playing";
      g.landlord = 0;
      g.turn = 0;
      g.hands[0] = hand;
      expect(applyAction(g, 0, action).phase).toBe("finished");
    }
  });

  it("completes seeded standard, wild, and heaven-earth games through the engine", () => {
    let completed = 0,
      decisions = 0;
    const largestDecisionMs: Record<Mode, number> = {
      standard: 0,
      wild: 0,
      "heaven-earth": 0,
    };
    for (const mode of ["standard", "wild", "heaven-earth"] as Mode[]) {
      for (let match = 0; match < 3; match++) {
        let g = createGame(
          `${mode}-${match}`,
          mode,
          shuffle(7100 + match * 83 + (mode === "wild" ? 401 : 0)),
          match,
          mode === "standard" ? null : 7 + match,
          10,
          mode === "heaven-earth" ? 9 + match : null,
        );
        // All-pass deals are replayed with the next deterministic shuffle.
        for (let redeals = 0; g.phase === "redeal" && redeals < 10; redeals++)
          g = createGame(
            `${mode}-${match}-${redeals}`,
            mode,
            shuffle(9000 + redeals + match * 19),
            match,
            mode === "standard" ? null : 7 + match,
            10,
            mode === "heaven-earth" ? 9 + match : null,
          );
        let steps = 0;
        while (g.phase !== "finished" && steps < 220) {
          if (g.phase === "redeal") {
            g = createGame(
              `${mode}-${match}-redo-${steps}`,
              mode,
              shuffle(12000 + steps + match * 47),
              match,
              mode === "standard" ? null : 7 + match,
              10,
              mode === "heaven-earth" ? 9 + match : null,
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
          largestDecisionMs[mode] = Math.max(
            largestDecisionMs[mode],
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
    expect(completed).toBe(9);
    expect(decisions).toBeGreaterThan(60);
    expect(largestDecisionMs.standard).toBeLessThan(200);
    expect(largestDecisionMs.wild).toBeLessThan(200);
    expect(largestDecisionMs["heaven-earth"]).toBeLessThan(1000);
  }, 60_000);
});
