import { describe, expect, it } from "vitest";
import { chooseAction } from "../server/ai.ts";
import { publicDeals } from "../server/ai-strategy.ts";
import { deck, gameWildRanks } from "../shared/cards.ts";
import { applyAction, createGame } from "../shared/engine.ts";
import { interpret } from "../shared/rules.ts";
import type {
  Card,
  Difficulty,
  GameAction,
  GameState,
  Mode,
  Personality,
  Play,
} from "../shared/types.ts";
import { match, observe, shuffled } from "./benchmark_ai.ts";

const modes: Mode[] = ["standard", "wild", "heaven-earth"];
const personalities: Personality[] = ["cautious", "balanced", "bold"];
const difficulties: Difficulty[] = ["dazed", "gentle", "fierce"];
const cardById = new Map(deck().map((card) => [card.id, card]));
const cards = (ids: string[]) => ids.map((id) => cardById.get(id)!);

function game(mode: Mode, seed = 4811) {
  return createGame(
    `${mode}-${seed}`,
    mode,
    shuffled(seed),
    0,
    mode === "standard" ? null : 7,
    10,
    mode === "heaven-earth" ? 8 : null,
  );
}
function toDoubling(initial: GameState) {
  let state = initial;
  while (state.phase === "bidding")
    state = applyAction(state, state.turn, {
      type: "bid",
      yes: state.turn === 0,
    });
  expect(state.landlord).toBe(0);
  expect(state.phase).toBe("doubling");
  return state;
}
function toPlaying(initial: GameState) {
  let state = toDoubling(initial);
  for (let seat = 0; seat < 3; seat++)
    state = applyAction(state, seat, { type: "double", yes: false });
  expect(state.phase).toBe("playing");
  return state;
}
const actionFor = (play: Play): GameAction => ({
  type: "play",
  cardIds: play.cards.map((card) => card.id),
  as: play.as,
  kind: play.kind,
  main: play.main,
});
function arrangedGame(landlordCards: Card[], farmerCards: Card[]) {
  expect(landlordCards).toHaveLength(20);
  expect(farmerCards.length).toBeLessThanOrEqual(17);
  const selected = new Set(
    [...landlordCards, ...farmerCards].map((card) => card.id),
  );
  expect(selected.size).toBe(landlordCards.length + farmerCards.length);
  const remaining = deck().filter((card) => !selected.has(card.id));
  const firstFarmer = [
    ...farmerCards,
    ...remaining.splice(0, 17 - farmerCards.length),
  ];
  const secondFarmer = remaining;
  expect(secondFarmer).toHaveLength(17);
  const order = [
    ...landlordCards.slice(0, 17),
    ...firstFarmer,
    ...secondFarmer,
    ...landlordCards.slice(17),
  ];
  return toPlaying(
    createGame("eight-wild", "heaven-earth", order, 0, 7, 10, 8),
  );
}

describe("AI difficulty contract", () => {
  it("keeps the omitted difficulty exactly equivalent to dazed", () => {
    for (const mode of modes) {
      const initial = game(mode);
      const playing = toPlaying(initial);
      for (const personality of personalities) {
        expect(chooseAction(observe(initial, 0), personality)).toEqual(
          chooseAction(observe(initial, 0), personality, "dazed"),
        );
        expect(chooseAction(observe(playing, 0), personality)).toEqual(
          chooseAction(observe(playing, 0), personality, "dazed"),
        );
      }
    }
  });

  it("returns engine-accepted actions for every difficulty, personality, and mode", () => {
    for (const mode of modes) {
      const bidding = game(mode);
      const doubling = toDoubling(bidding);
      const lead = toPlaying(bidding);
      const single = lead.hands[0].find((card) => card.rank <= 15)!;
      const response = applyAction(lead, 0, {
        type: "play",
        cardIds: [single.id],
        as: [single.rank],
        kind: "single",
        main: single.rank,
      });
      for (const difficulty of difficulties)
        for (const personality of personalities)
          for (const [state, seat] of [
            [bidding, 0],
            [doubling, 0],
            [response, 1],
          ] as [GameState, number][]) {
            const observation = observe(state, seat);
            expect(observation).not.toHaveProperty("hands");
            const decision = chooseAction(observation, personality, difficulty);
            expect(decision.explanation.length).toBeGreaterThan(0);
            expect(() =>
              applyAction(state, seat, decision.action),
            ).not.toThrow();
          }
    }
  }, 30_000);

  it("samples only possible unseen cards with exact seat counts and public bottom cards", () => {
    for (const mode of modes) {
      let state = toPlaying(game(mode, 6281));
      for (let move = 0; move < 5 && state.phase === "playing"; move++) {
        const decision = chooseAction(
          observe(state, state.turn),
          "balanced",
          "dazed",
        );
        state = applyAction(state, state.turn, decision.action);
      }
      for (const seat of [0, 1, 2]) {
        const observation = observe(state, seat);
        const known = new Set(
          [
            ...observation.hand,
            ...observation.played,
            ...observation.bottom,
          ].map((card) => card.id),
        );
        const played = new Set(observation.played.map((card) => card.id));
        const heldBottom = observation.bottom.filter(
          (card) => !played.has(card.id),
        );
        const deals = publicDeals(observation, 8);
        expect(deals).toHaveLength(8);
        for (const hands of deals) {
          expect(hands.map((hand) => hand.length)).toEqual(observation.counts);
          expect(hands[seat]).toEqual(observation.hand);
          const all = hands.flat();
          expect(new Set(all.map((card) => card.id)).size).toBe(all.length);
          expect(all.every((card) => !played.has(card.id))).toBe(true);
          for (let other = 0; other < 3; other++) {
            if (other === seat) continue;
            expect(
              hands[other].every(
                (card) =>
                  !known.has(card.id) ||
                  (other === state.landlord &&
                    heldBottom.some((bottom) => bottom.id === card.id)),
              ),
            ).toBe(true);
          }
          if (seat !== state.landlord)
            for (const card of heldBottom)
              expect(
                hands[state.landlord].some((held) => held.id === card.id),
              ).toBe(true);
        }
        // Swap two unseen physical cards. The valid public observation and its
        // sampled deals stay identical despite a different true hidden deal.
        const hidden = structuredClone(state);
        const others = [0, 1, 2].filter((other) => other !== seat);
        const movable = (other: number) =>
          hidden.hands[other].findIndex(
            (card) => !heldBottom.some((bottom) => bottom.id === card.id),
          );
        const a = movable(others[0]),
          b = movable(others[1]);
        if (a >= 0 && b >= 0) {
          [hidden.hands[others[0]][a], hidden.hands[others[1]][b]] = [
            hidden.hands[others[1]][b],
            hidden.hands[others[0]][a],
          ];
          expect(observe(hidden, seat)).toEqual(observation);
          expect(publicDeals(observe(hidden, seat), 8)).toEqual(deals);
        }
      }
    }
  });

  it("finishes seeded games on gentle and fierce in all three modes", () => {
    let completed = 0;
    const timings: {
      difficulty: Difficulty;
      mode: Mode;
      decisions: number;
      maxMs: number;
    }[] = [];
    for (const difficulty of ["gentle", "fierce"] as const)
      for (const mode of modes) {
        const result = match(mode, 13871, [difficulty, difficulty, difficulty]);
        expect(result.decisions).toBeLessThan(240);
        expect(["landlord", "farmers"]).toContain(result.winner);
        timings.push({
          difficulty,
          mode,
          decisions: result.decisions,
          maxMs: Math.round(result.maxMs),
        });
        completed++;
      }
    expect(completed).toBe(6);
    console.info("AI difficulty match timings", timings);
  }, 120_000);

  it("finishes an eight-wildcard hand and accepts its long-bomb reply", () => {
    const allWild = deck().filter((card) => card.rank === 7 || card.rank === 8);
    const finishHand = [
      ...allWild,
      ...deck().filter(
        (card) => [6, 10, 11, 14].includes(card.rank) && card.suit !== "D",
      ),
    ];
    const direct = arrangedGame(finishHand, []);
    expect(direct.hands[0]).toHaveLength(20);
    const body = cards([
      "3S",
      "3H",
      "3C",
      "4S",
      "4H",
      "4C",
      "5S",
      "5H",
      "5C",
      "6S",
      "9S",
      "10S",
    ]);
    const replyGame = arrangedGame(
      [...allWild, ...body],
      cards(["11S", "11H", "11C", "11D"]),
    );
    const airplane = interpret(body, gameWildRanks(replyGame)).find(
      (play) => play.kind === "airplaneSingle",
    );
    expect(airplane).toBeDefined();
    let state = applyAction(replyGame, 0, actionFor(airplane!));
    const bomb = interpret(
      cards(["11S", "11H", "11C", "11D"]),
      gameWildRanks(state),
    ).find((play) => play.kind === "bomb");
    expect(bomb).toBeDefined();
    state = applyAction(state, 1, actionFor(bomb!));
    state = applyAction(state, 2, { type: "pass" });
    expect(state.hands[0].map((card) => card.id).sort()).toEqual(
      allWild.map((card) => card.id).sort(),
    );
    let maximumEightWildMs = 0;
    for (const difficulty of ["gentle", "fierce"] as const)
      for (const personality of personalities) {
        const started = performance.now();
        const finish = chooseAction(
          observe(direct, 0),
          personality,
          difficulty,
        );
        const finishMs = performance.now() - started;
        maximumEightWildMs = Math.max(maximumEightWildMs, finishMs);
        expect(finishMs).toBeLessThan(1000);
        expect(finish.action.type).toBe("play");
        if (finish.action.type === "play") {
          expect(finish.action.cardIds).toHaveLength(20);
          expect(applyAction(direct, 0, finish.action).phase).toBe("finished");
        }
        const replyStarted = performance.now();
        const reply = chooseAction(observe(state, 0), personality, difficulty);
        const replyMs = performance.now() - replyStarted;
        maximumEightWildMs = Math.max(maximumEightWildMs, replyMs);
        expect(replyMs).toBeLessThan(1000);
        expect(reply.action.type).toBe("play");
        if (reply.action.type === "play") {
          expect(reply.action.kind).toBe("mixedWildBomb");
          expect(reply.action.cardIds).toHaveLength(8);
          expect(applyAction(state, 0, reply.action).phase).toBe("finished");
        }
      }
    console.info(
      "AI eight-wildcard maximum decision ms",
      Math.round(maximumEightWildMs),
    );
  }, 30_000);
});
