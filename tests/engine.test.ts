import { describe, expect, it } from "vitest";
import { deck } from "../shared/cards.ts";
import { applyAction, createGame, forfeit } from "../shared/engine.ts";
import { legalMoves } from "../shared/rules.ts";
import type { Card, GameState, Mode } from "../shared/types.ts";

const all = deck();
const card = (id: string): Card => all.find((c) => c.id === id)!;
const cards = (...ids: string[]) => ids.map(card);
function game(mode: Mode = "standard", bottom?: Card[]): GameState {
  const tail = bottom ?? cards("3S", "8H", "13C");
  const tailIds = new Set(tail.map((c) => c.id));
  return createGame(
    "test",
    mode,
    [...all.filter((c) => !tailIds.has(c.id)), ...tail],
    0,
    mode === "wild" ? 7 : null,
  );
}
function doubled(mode: Mode = "standard", bottom?: Card[]): GameState {
  let g = game(mode, bottom);
  g = applyAction(g, 0, { type: "bid", yes: true });
  g = applyAction(g, 1, { type: "bid", yes: false });
  g = applyAction(g, 2, { type: "bid", yes: false });
  expect(g.phase).toBe("doubling");
  return g;
}
function playing(mode: Mode = "standard", bottom?: Card[]): GameState {
  let g = doubled(mode, bottom);
  for (const seat of [0, 1, 2])
    g = applyAction(g, seat, { type: "double", yes: false });
  expect(g.phase).toBe("playing");
  return g;
}
function shuffle(seed: number): Card[] {
  let x = seed;
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

describe("bidding, doubling and play transitions", () => {
  it("redeals after three passes and does not assign a landlord", () => {
    let g = game();
    for (const seat of [0, 1, 2])
      g = applyAction(g, seat, { type: "bid", yes: false });
    expect(g.phase).toBe("redeal");
    expect(g.landlord).toBe(-1);
    expect(g.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(() => applyAction(g, 0, { type: "bid", yes: true })).toThrow();
  });

  it("skips earlier non-callers during robbing and gives the caller a final regrab", () => {
    let g = game();
    g = applyAction(g, 0, { type: "bid", yes: false });
    g = applyAction(g, 1, { type: "bid", yes: true });
    expect(g.turn).toBe(2);
    g = applyAction(g, 2, { type: "bid", yes: false });
    expect(g.landlord).toBe(1);
    expect(g.hands.map((h) => h.length)).toEqual([17, 20, 17]);

    g = game();
    g = applyAction(g, 0, { type: "bid", yes: true });
    g = applyAction(g, 1, { type: "bid", yes: true });
    expect(g.multiplier).toBe("30");
    g = applyAction(g, 2, { type: "bid", yes: false });
    expect(g.turn).toBe(0);
    expect(g.phase).toBe("bidding");
    g = applyAction(g, 0, { type: "bid", yes: true });
    expect(g.landlord).toBe(0);
    expect(
      g.multiplierEvents.filter((e) => e.reason === "抢地主"),
    ).toHaveLength(2);
    expect(g.multiplier).toBe("60");
  });

  it("accepts each double once, keeping personal choices out of events until revealed", () => {
    let g = doubled();
    const publicMultiplier = g.multiplier;
    g = applyAction(g, 1, { type: "double", yes: true });
    expect(g.doubles).toEqual([null, 2, null]);
    expect(g.events.filter((e) => e.type === "double")).toHaveLength(0);
    expect(() => applyAction(g, 1, { type: "double", yes: false })).toThrow();
    g = applyAction(g, 0, { type: "double", yes: false });
    expect(g.events.filter((e) => e.type === "double")).toHaveLength(0);
    g = applyAction(g, 2, { type: "double", yes: true });
    expect(g.phase).toBe("playing");
    expect(g.turn).toBe(g.landlord);
    expect(g.doubles).toEqual([1, 2, 2]);
    expect(g.multiplier).toBe(publicMultiplier);
    expect(
      g.events.filter((e) => e.type === "double").map((e) => e.text),
    ).toEqual(["不加倍", "主动加倍 ×2", "主动加倍 ×2"]);
  });

  it("rejects lead passing and resets the trick after both opponents pass", () => {
    let g = playing();
    expect(() => applyAction(g, 0, { type: "pass" })).toThrow("领出");
    const selected = g.hands[0][0];
    g = applyAction(g, 0, { type: "play", cardIds: [selected.id] });
    expect(g.trick?.seat).toBe(0);
    g = applyAction(g, 1, { type: "pass" });
    expect(g.turn).toBe(2);
    expect(g.passes).toBe(1);
    g = applyAction(g, 2, { type: "pass" });
    expect(g.turn).toBe(0);
    expect(g.trick).toBeNull();
    expect(g.passes).toBe(0);
    expect(() => applyAction(g, 0, { type: "pass" })).toThrow("领出");
  });

  it("rejects duplicate, missing and off-turn physical cards and requires explicit ambiguous wild interpretation", () => {
    let g = playing();
    const own = g.hands[0][0].id;
    const other = g.hands[1][0].id;
    expect(() => applyAction(g, 1, { type: "play", cardIds: [other] })).toThrow(
      "还没轮到你",
    );
    expect(() =>
      applyAction(g, 0, { type: "play", cardIds: [own, own] }),
    ).toThrow("有效手牌");
    expect(() => applyAction(g, 0, { type: "play", cardIds: [other] })).toThrow(
      "不在你的手中",
    );
    expect(() => applyAction(g, 0, { type: "play", cardIds: [] })).toThrow(
      "有效手牌",
    );

    g = playing("wild");
    g.hands[0] = cards("7S", "8S", "8H", "8C", "3S");
    expect(() =>
      applyAction(g, 0, { type: "play", cardIds: ["7S", "8S", "8H", "8C"] }),
    ).toThrow("请选择癞子的牌型解释");
    const selected = applyAction(g, 0, {
      type: "play",
      cardIds: ["7S", "8S", "8H", "8C"],
      as: [8, 8, 8, 8],
    });
    expect(selected.trick?.play.kind).toBe("softBomb");
    expect(selected.multiplier).toBe((BigInt(g.multiplier) * 2n).toString());
    expect(g.hands[0]).toHaveLength(5); // applyAction preserves its input.
  });

  it.each([
    ["standard", ["4S", "4H", "4C", "4D"], 2],
    ["wild", ["7S", "8S", "8H", "8C"], 2],
    ["wild", ["4S", "4H", "4C", "4D"], 4],
    ["wild", ["7S", "7H", "7C", "7D"], 4],
    ["wild", ["16J", "17J"], 4],
  ] as [Mode, string[], number][])(
    "applies the correct public bomb factor in %s",
    (mode, ids, factor) => {
      const g = playing(mode);
      g.hands[0] = [...cards(...ids), card("3S")];
      const as =
        ids[0] === "7S" && ids.length === 4 && ids[1] === "8S"
          ? [8, 8, 8, 8]
          : ids.map((id) => card(id).rank);
      const next = applyAction(g, 0, { type: "play", cardIds: ids, as });
      expect(next.multiplier).toBe(
        (BigInt(g.multiplier) * BigInt(factor)).toString(),
      );
      expect(next.multiplierEvents.at(-1)?.factor).toBe(factor);
    },
  );

  it("applies exactly one highest bottom bonus on landlord assignment", () => {
    const g = doubled("standard", cards("12S", "13S", "14S"));
    expect(g.multiplier).toBe("60");
    expect(
      g.multiplierEvents.filter((e) => e.reason.startsWith("底牌")),
    ).toEqual([{ reason: "底牌同花顺", factor: 4, value: "60" }]);
  });

  it("triggers landlord spring and farmer anti-spring only on actual played-out wins", () => {
    let g = playing();
    g.hands[0] = cards("3S");
    const landlordWin = applyAction(g, 0, { type: "play", cardIds: ["3S"] });
    expect(landlordWin.phase).toBe("finished");
    expect(landlordWin.winner).toBe("landlord");
    expect(landlordWin.multiplier).toBe((BigInt(g.multiplier) * 2n).toString());
    expect(landlordWin.multiplierEvents.at(-1)?.reason).toBe("春天");

    g = playing();
    g.turn = 1;
    g.hands[1] = cards("3S");
    g.playedCounts[0] = 1;
    const farmerWin = applyAction(g, 1, { type: "play", cardIds: ["3S"] });
    expect(farmerWin.winner).toBe("farmers");
    expect(farmerWin.multiplier).toBe((BigInt(g.multiplier) * 2n).toString());
    expect(farmerWin.multiplierEvents.at(-1)?.reason).toBe("反春天");
    g.playedCounts[0] = 2;
    expect(
      applyAction(g, 1, {
        type: "play",
        cardIds: ["3S"],
      }).multiplierEvents.some((e) => e.reason === "反春天"),
    ).toBe(false);
  });

  it("forfeit determines the opposite side without spring or partial double effects", () => {
    const beforeBid = forfeit(game(), 0);
    expect(beforeBid).toMatchObject({ phase: "finished", winner: null });
    let g = doubled();
    g = applyAction(g, 1, { type: "double", yes: true });
    const quitLandlord = forfeit(g, 0);
    expect(quitLandlord.winner).toBe("farmers");
    expect(quitLandlord.doubles).toEqual([1, 1, 1]);
    expect(quitLandlord.multiplier).toBe(g.multiplier);
    expect(
      quitLandlord.multiplierEvents.some(
        (e) => e.reason === "春天" || e.reason === "反春天",
      ),
    ).toBe(false);
    expect(forfeit(g, 1).winner).toBe("landlord");
  });

  it("rejects a duplicated physical deck before dealing", () => {
    const invalid = deck();
    invalid[53] = invalid[0];
    expect(() => createGame("bad", "standard", invalid, 0, null)).toThrow(
      "牌组无效",
    );
  });

  it("preserves all 54 physical cards during randomized legal gameplay", () => {
    for (const mode of ["standard", "wild"] as Mode[]) {
      for (let match = 0; match < 2; match++) {
        let seed = 510 + match * 71 + (mode === "wild" ? 1000 : 0);
        const random = () => {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          return (seed >>> 0) / 0x100000000;
        };
        let g = createGame(
          `${mode}-${match}`,
          mode,
          shuffle(seed),
          0,
          mode === "wild" ? 7 : null,
        );
        g = applyAction(g, 0, { type: "bid", yes: true });
        g = applyAction(g, 1, { type: "bid", yes: false });
        g = applyAction(g, 2, { type: "bid", yes: false });
        for (const seat of [0, 1, 2])
          g = applyAction(g, seat, { type: "double", yes: false });
        let steps = 0;
        while (g.phase === "playing" && steps++ < 220) {
          const physical = [
            ...g.hands.flat(),
            ...g.events.flatMap((e) => e.play?.cards ?? []),
          ];
          expect(physical).toHaveLength(54);
          expect(new Set(physical.map((c) => c.id)).size).toBe(54);
          const previous = g.trick?.play ?? null;
          const moves = legalMoves(g.hands[g.turn], g.wildRank, previous);
          if (previous && (!moves.length || random() < 0.32)) {
            g = applyAction(g, g.turn, { type: "pass" });
          } else {
            const move =
              moves[Math.floor(random() * Math.min(moves.length, 20))];
            expect(move).toBeDefined();
            g = applyAction(g, g.turn, {
              type: "play",
              cardIds: move.cards.map((c) => c.id),
              as: move.as,
            });
          }
        }
        expect(g.phase).toBe("finished");
        expect(g.winner).not.toBeNull();
      }
    }
  }, 30_000);
});
