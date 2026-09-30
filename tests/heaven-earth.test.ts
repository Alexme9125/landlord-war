import { describe, expect, it } from "vitest";
import { deck, gameWildRanks, isWildRank } from "../shared/cards.ts";
import { applyAction, createGame } from "../shared/engine.ts";
import { beats, bombFactor, interpret, legalMoves } from "../shared/rules.ts";
import type { Card, Play } from "../shared/types.ts";

const all = deck();
const cards = (...ids: string[]) =>
  ids.map((id) => all.find((c) => c.id === id)!);
const wilds = all.filter((c) => c.rank === 7 || c.rank === 9);
const signature = (p: Play) => `${p.kind}:${p.main}:${p.chain}`;
const keys = (plays: Play[]) => [...new Set(plays.map(signature))].sort();
function lead(
  selected: Card[],
  as: number[],
  kind?: Play["kind"],
  main?: number,
) {
  const game = createGame("td", "heaven-earth", all, 0, 9, 20, 7);
  game.phase = "playing";
  game.landlord = 0;
  game.doubles = [1, 1, 1];
  game.hands[0] = [
    ...selected,
    all.find((c) => !selected.some((s) => s.id === c.id))!,
  ];
  game.playedCounts = [1, 1, 1];
  return applyAction(game, 0, {
    type: "play",
    cardIds: selected.map((c) => c.id),
    as,
    kind,
    main,
  });
}

describe("heaven and earth wildcard rules", () => {
  it("requires two different non-joker ranks and keeps older modes unchanged", () => {
    for (const heaven of [null, 9, 2, 16, 17, 7.5])
      expect(() =>
        createGame("bad", "heaven-earth", all, 0, 9, 10, heaven),
      ).toThrow("两个不同");
    const game = createGame("td", "heaven-earth", all, 0, 9, 50, 7);
    expect(gameWildRanks(game)).toEqual([7, 9]);
    expect(game).toMatchObject({ multiplier: "15", baseStake: 50 });
    expect(
      gameWildRanks(createGame("classic", "standard", all, 0, null)),
    ).toEqual([]);
    expect(gameWildRanks(createGame("wild", "wild", all, 0, 7))).toEqual([7]);
    expect(gameWildRanks({ wildRank: 7 })).toEqual([7]);
  });

  it("substitutes both ranks while retaining physical cards and rejects joker substitution", () => {
    const material = cards("8S", "7H", "9C");
    expect(interpret(material, [7, 9], [8, 8, 8])).toMatchObject([
      { kind: "triple", main: 8 },
    ]);
    expect(interpret(material, [7, 9], [16, 16, 16])).toEqual([]);
    expect(interpret(cards("16J", "9C"), [7, 9], [16, 17])).toEqual([]);
    expect(interpret(cards("7S", "9S"), [7, 9], [7, 7])).toEqual([]);
    expect(interpret(cards("7S", "7H", "9S"), [7, 9], [7, 7, 7])).toEqual([]);
    expect(interpret(cards("7S", "7H"), [7, 9])).toMatchObject([
      { kind: "pair", main: 7 },
    ]);
    expect(
      interpret(cards("3S", "3H", "4S", "4H", "7S", "9S"), [7, 9]).some(
        (p) => p.kind === "pairChain" && p.main === 5,
      ),
    ).toBe(true);
  });

  it("offers natural ordinary patterns and a distinct mixed wildcard bomb without arbitrary reassignment", () => {
    const material = cards("7S", "7H", "7C", "9S");
    const choices = interpret(material, [7, 9]);
    expect(keys(choices)).toEqual(["mixedWildBomb:9:1", "tripleSingle:7:1"]);
    expect(interpret(material, [7, 9], [9, 9, 9, 9])).toMatchObject([
      { kind: "mixedWildBomb" },
    ]);
    expect(interpret(material, [7, 9], [15, 15, 15, 15])).toEqual([]);
    expect(
      interpret(cards("7S", "7H", "7C", "7D"), [7, 9], [9, 9, 9, 9]),
    ).toEqual([]);
    expect(
      interpret(wilds, [7, 9]).some(
        (p) => p.kind === "mixedWildBomb" && p.cards.length === 8,
      ),
    ).toBe(true);
  });

  it("orders all bomb lengths and tiers with rocket above twelve cards", () => {
    const get = (selected: Card[], as: number[], kind: Play["kind"]) =>
      interpret(selected, [7, 9], as).find((p) => p.kind === kind)!;
    const soft = get(
      cards("15S", "15H", "15C", "7S"),
      [15, 15, 15, 15],
      "softBomb",
    );
    const hard = get(cards("3S", "3H", "3C", "3D"), [3, 3, 3, 3], "bomb");
    const mixed = get(
      cards("7S", "7H", "9S", "9H"),
      [9, 9, 9, 9],
      "mixedWildBomb",
    );
    const pure = get(cards("7S", "7H", "7C", "7D"), [7, 7, 7, 7], "wildBomb");
    const ordered = [soft, hard, mixed, pure];
    for (let size = 5; size <= 12; size++) {
      const material = [
        ...cards("3S", "3H", "3C", "3D"),
        ...wilds.slice(0, size - 4),
      ];
      ordered.push(get(material, Array(size).fill(3), "softBomb"));
      if (size <= 8) {
        const mixedCards = [
          ...wilds.filter((c) => c.rank === 7).slice(0, 4),
          ...wilds.filter((c) => c.rank === 9).slice(0, size - 4),
        ];
        ordered.push(get(mixedCards, Array(size).fill(9), "mixedWildBomb"));
      }
    }
    ordered.push(interpret(cards("16J", "17J"), [7, 9])[0]);
    for (let i = 0; i < ordered.length; i++) {
      expect(ordered[i]).toBeDefined();
      expect(beats(ordered[i], ordered[i])).toBe(false);
      for (let j = 0; j < i; j++) {
        expect(beats(ordered[i], ordered[j])).toBe(true);
        expect(beats(ordered[j], ordered[i])).toBe(false);
      }
    }
    const otherMixed = get(
      cards("7S", "9S", "9H", "9C"),
      [9, 9, 9, 9],
      "mixedWildBomb",
    );
    expect(beats(otherMixed, mixed)).toBe(false);
    expect(beats(mixed, otherMixed)).toBe(false);
    expect(
      beats(get(cards("9S", "9H", "9C", "9D"), [9, 9, 9, 9], "wildBomb"), pure),
    ).toBe(true);
  });

  it("keeps long bombs exclusive to heaven-earth and generates both soft and all-wild long responses", () => {
    const material = cards("3S", "3H", "3C", "3D", "7S");
    expect(interpret(material, null, [3, 3, 3, 3, 3])).toEqual([]);
    expect(interpret(material, 7, [3, 3, 3, 3, 3])).toEqual([]);
    const twelve = [...cards("3S", "3H", "3C", "3D"), ...wilds];
    const candidates = legalMoves(twelve, [7, 9]);
    expect(
      candidates.some((p) => p.kind === "softBomb" && p.cards.length === 12),
    ).toBe(true);
    for (let size = 4; size <= 8; size++)
      expect(
        candidates.some(
          (p) => p.kind === "mixedWildBomb" && p.cards.length === size,
        ),
      ).toBe(true);
    for (const play of candidates)
      expect(
        interpret(play.cards, [7, 9], play.as).some(
          (p) => signature(p) === signature(play),
        ),
      ).toBe(true);
  });

  it.each([
    [cards("3S", "3H", "3C", "7S"), [3, 3, 3, 3], 2],
    [cards("3S", "3H", "3C", "3D"), [3, 3, 3, 3], 4],
    [cards("7S", "7H", "9S", "9H"), [9, 9, 9, 9], 4],
    [cards("7S", "7H", "7C", "7D"), [7, 7, 7, 7], 4],
    [cards("3S", "3H", "3C", "3D", "9S"), [3, 3, 3, 3, 3], 6],
    [[...cards("3S", "3H", "3C", "3D"), ...wilds], Array(12).fill(3), 6],
    [wilds, Array(8).fill(9), 6],
    [cards("16J", "17J"), [16, 17], 6],
  ] as [Card[], number[], number][])(
    "multiplies only a played bomb by its mode-specific factor",
    (selected, as, factor) => {
      const next = lead(selected, as);
      expect(next.multiplier).toBe(String(15 * factor));
      expect(next.multiplierEvents.at(-1)).toMatchObject({
        factor,
        value: String(15 * factor),
      });
      expect(bombFactor("standard", interpret(cards("16J", "17J"))[0])).toBe(2);
      expect(bombFactor("wild", interpret(cards("16J", "17J"))[0])).toBe(4);
    },
  );

  it("honors the chosen airplane body when the same cards and assignments have several interpretations", () => {
    const material = all.filter(
      (c) => c.rank >= 3 && c.rank <= 6 && c.suit !== "D",
    );
    const as = material.map((c) => c.rank);
    expect(interpret(material, [7, 9], as).length).toBeGreaterThan(1);
    expect(lead(material, as, "airplaneSingle", 5).trick?.play).toMatchObject({
      kind: "airplaneSingle",
      main: 5,
      chain: 3,
    });
    expect(() => lead(material, as, "airplaneSingle", 14)).toThrow("牌型无效");
  });

  it("matches every legal body found by exhaustive small-wildcard assignment", () => {
    const selections = [
      cards("3S", "3H", "4S", "7S", "9S"),
      cards("3S", "3H", "4S", "4H", "7S", "9S"),
      cards("3S", "3H", "3C", "4S", "4H", "7S", "7H", "9S"),
      cards(
        "3S",
        "3H",
        "3C",
        "4S",
        "4H",
        "4C",
        "5S",
        "5H",
        "5C",
        "7S",
        "7H",
        "9S",
      ),
      cards("3S", "3H", "3C", "3D", "4S", "7S", "7H", "9S"),
      cards("3S", "3H", "3C", "3D", "16J", "7S", "7H", "9S"),
    ];
    for (const material of selections) {
      const as = material.map((c) => c.rank);
      const indexes = material.flatMap((c, i) =>
        isWildRank(c.rank, [7, 9]) ? [i] : [],
      );
      const found: Play[] = [];
      const enumerate = (depth: number) => {
        if (depth === indexes.length) {
          found.push(...interpret(material, [7, 9], [...as]));
          return;
        }
        for (let rank = 3; rank <= 15; rank++) {
          as[indexes[depth]] = rank;
          enumerate(depth + 1);
        }
      };
      enumerate(0);
      expect(
        keys(interpret(material, [7, 9])),
        material.map((c) => c.id).join(","),
      ).toEqual(keys(found));
    }
  });

  it("interprets eight wildcards in a selected hand without an exponential search", () => {
    const material = [...cards("3S", "4S", "5S", "6S"), ...wilds];
    const start = performance.now();
    const plays = interpret(material, [7, 9]);
    const elapsed = performance.now() - start;
    expect(
      plays.some((p) => p.kind === "airplane" && p.chain === 4 && p.main === 6),
    ).toBe(true);
    expect(elapsed).toBeLessThan(750);
    for (const play of plays)
      expect(
        interpret(material, [7, 9], play.as).some(
          (p) => signature(p) === signature(play),
        ),
      ).toBe(true);
  });
});
