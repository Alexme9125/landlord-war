import { describe, expect, it } from "vitest";
import { deck } from "../shared/cards.ts";
import {
  beats,
  bombLevel,
  bottomBonus,
  interpret,
  legalMoves,
} from "../shared/rules.ts";
import type { Card, Play, PlayKind } from "../shared/types.ts";

const all = deck();
const cards = (...ids: string[]): Card[] =>
  ids.map((id) => all.find((card) => card.id === id)!);
const first = (
  ids: string[],
  wild: number | null = null,
  as?: number[],
): Play => {
  const play = interpret(cards(...ids), wild, as)[0];
  expect(play).toBeDefined();
  return play;
};
const kinds = (
  ids: string[],
  wild: number | null = null,
  as?: number[],
): PlayKind[] => interpret(cards(...ids), wild, as).map((p) => p.kind);

describe("card patterns and rankings", () => {
  it.each([
    [["3S"], "single"],
    [["3S", "3H"], "pair"],
    [["3S", "3H", "3C"], "triple"],
    [["3S", "3H", "3C", "4S"], "tripleSingle"],
    [["3S", "3H", "3C", "4S", "4H"], "triplePair"],
    [["3S", "4S", "5S", "6S", "7S"], "straight"],
    [["3S", "3H", "4S", "4H", "5S", "5H"], "pairChain"],
    [["3S", "3H", "3C", "4S", "4H", "4C"], "airplane"],
    [["3S", "3H", "3C", "4S", "4H", "4C", "5S", "5H"], "airplaneSingle"],
    [
      ["3S", "3H", "3C", "4S", "4H", "4C", "5S", "5H", "6S", "6H"],
      "airplanePair",
    ],
    [["3S", "3H", "3C", "3D", "4S", "4H"], "fourSingle"],
    [["3S", "3H", "3C", "3D", "4S", "4H", "5S", "5H"], "fourPair"],
    [["3S", "3H", "3C", "3D"], "bomb"],
    [["16J", "17J"], "rocket"],
  ] as [string[], PlayKind][])("recognizes %j as %s", (ids, kind) => {
    expect(kinds(ids)).toContain(kind);
  });

  it("allows paired singles as wings but rejects joker pair, body ranks and a four-of-a-kind wing", () => {
    expect(kinds(["3S", "3H", "3C", "4S", "4H", "4C", "5S", "5H"])).toContain(
      "airplaneSingle",
    );
    expect(kinds(["3S", "3H", "3C", "3D", "4S", "4H"])).toContain("fourSingle");
    expect(kinds(["3S", "3H", "3C", "3D", "16J", "17J"])).not.toContain(
      "fourSingle",
    );
    expect(
      kinds(["3S", "3H", "3C", "4S", "4H", "4C", "16J", "17J"]),
    ).not.toContain("airplaneSingle");
    expect(
      kinds(["3S", "3H", "3C", "4S", "4H", "4C", "3D", "5S"]),
    ).not.toContain("airplaneSingle");
    expect(
      kinds(["3S", "3H", "3C", "4S", "4H", "4C", "5S", "5H", "5C", "5D"]),
    ).not.toContain("airplaneSingle");
    expect(
      kinds(["3S", "3H", "3C", "3D", "4S", "4H", "4C", "4D"]),
    ).not.toContain("fourPair");
    expect(
      kinds(["3S", "3H", "3C", "3D", "4S", "4H", "5S", "6S"]),
    ).not.toContain("fourPair");
  });

  it("keeps twos and jokers out of chains and enforces chain minima", () => {
    expect(kinds(["11S", "12S", "13S", "14S", "15S"])).not.toContain(
      "straight",
    );
    expect(kinds(["12S", "13S", "14S", "15S", "16J"])).not.toContain(
      "straight",
    );
    expect(kinds(["12S", "13S", "14S", "15S"])).not.toContain("straight");
    expect(kinds(["13S", "13H", "14S", "14H", "15S", "15H"])).not.toContain(
      "pairChain",
    );
    expect(
      kinds(["13S", "13H", "13C", "14S", "14H", "14C", "15S", "15H", "15C"]),
    ).not.toContain("airplane");
    expect(kinds(["12S", "13S", "14S", "11S", "10S"])).toContain("straight");
  });

  it("honors explicit wild assignments and rejects invalid physical selections", () => {
    const material = cards("7S", "8S", "8H", "8C");
    expect(
      kinds(
        material.map((c) => c.id),
        7,
      ),
    ).toContain("tripleSingle");
    expect(
      kinds(
        material.map((c) => c.id),
        7,
      ),
    ).toContain("softBomb");
    expect(
      kinds(
        material.map((c) => c.id),
        7,
        [8, 8, 8, 8],
      ),
    ).toEqual(["softBomb"]);
    expect(
      kinds(
        material.map((c) => c.id),
        7,
        [7, 8, 8, 8],
      ),
    ).toEqual(["tripleSingle"]);
    expect(interpret(material, 7, [16, 8, 8, 8])).toEqual([]);
    expect(interpret(material, 7, [8, 7, 8, 8])).toEqual([]);
    expect(interpret(material, 7, [8, 8])).toEqual([]);
    expect(interpret(cards("7S", "7H", "7C", "7D"), 7, [8, 8, 8, 8])).toEqual(
      [],
    );
    expect(interpret(cards("3S", "3S"), null)).toEqual([]);
    expect(interpret([])).toEqual([]);
  });

  it("orders soft, hard, pure wild and rocket bombs and requires matching non-bomb patterns", () => {
    const soft = first(["7S", "8S", "8H", "8C"], 7, [8, 8, 8, 8]);
    const hard = first(["3S", "3H", "3C", "3D"], 7);
    const pure = first(["7S", "7H", "7C", "7D"], 7);
    const rocket = first(["16J", "17J"], 7);
    expect([soft, hard, pure, rocket].map(bombLevel)).toEqual([1, 2, 3, 4]);
    expect(beats(hard, soft)).toBe(true);
    expect(beats(pure, hard)).toBe(true);
    expect(beats(rocket, pure)).toBe(true);
    expect(beats(pure, rocket)).toBe(false);
    expect(beats(first(["4S", "4H"]), first(["3S", "3H"]))).toBe(true);
    expect(beats(first(["4S", "4H"]), first(["3S"]))).toBe(false);
    expect(
      beats(
        first(["4S", "5S", "6S", "7S", "8S"]),
        first(["3S", "4S", "5S", "6S", "7S"]),
      ),
    ).toBe(true);
    expect(
      beats(
        first(["4S", "5S", "6S", "7S", "8S"]),
        first(["3S", "4S", "5S", "6S", "7S", "8S"]),
      ),
    ).toBe(false);
  });

  it("awards only the highest bottom-card bonus and respects straight boundaries", () => {
    expect(bottomBonus(cards("16J", "17J", "3S"))).toEqual({
      factor: 4,
      reason: "底牌双王",
    });
    expect(bottomBonus(cards("4S", "4H", "4D"))).toEqual({
      factor: 4,
      reason: "底牌三条",
    });
    expect(bottomBonus(cards("12S", "13S", "14S"))).toEqual({
      factor: 4,
      reason: "底牌同花顺",
    });
    expect(bottomBonus(cards("12S", "13H", "14D"))).toEqual({
      factor: 2,
      reason: "底牌顺子",
    });
    expect(bottomBonus(cards("13S", "14H", "15D"))).toBeNull();
    expect(bottomBonus(cards("13S", "14S", "15S"))).toEqual({
      factor: 2,
      reason: "底牌同花",
    });
    expect(bottomBonus(cards("16J", "3S", "4S"))).toEqual({
      factor: 2,
      reason: "底牌单王",
    });
  });

  it("randomized legalMoves returns only distinct legal interpretations from the hand", () => {
    let seed = 879;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };
    for (let trial = 0; trial < 24; trial++) {
      const shuffled = [...all];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const hand = shuffled.slice(0, trial % 2 ? 17 : 20);
      const wild = trial % 2 ? null : 7;
      const previous = trial % 3 ? first([`${3 + (trial % 10)}S`]) : null;
      const moves = legalMoves(hand, wild, previous);
      const ids = new Set(hand.map((c) => c.id));
      const seen = new Set<string>();
      for (const p of moves) {
        expect(p.cards.every((c) => ids.has(c.id))).toBe(true);
        expect(new Set(p.cards.map((c) => c.id)).size).toBe(p.cards.length);
        expect(
          interpret(p.cards, wild, p.as).some(
            (q) =>
              q.kind === p.kind && q.main === p.main && q.chain === p.chain,
          ),
        ).toBe(true);
        expect(beats(p, previous)).toBe(true);
        const key = `${p.cards
          .map((c) => c.id)
          .sort()
          .join(",")}:${p.kind}:${p.main}:${p.chain}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});
