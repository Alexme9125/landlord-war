import type { Card, Mode, Play, PlayKind, Wildcards } from "./types.ts";
import { isWildRank, rankText } from "./cards.ts";

const names: Record<PlayKind, string> = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  tripleSingle: "三带一",
  triplePair: "三带一对",
  straight: "顺子",
  pairChain: "连对",
  airplane: "飞机",
  airplaneSingle: "飞机带单",
  airplanePair: "飞机带对",
  fourSingle: "四带二",
  fourPair: "四带两对",
  softBomb: "软炸弹",
  bomb: "炸弹",
  wildBomb: "纯癞子炸弹",
  mixedWildBomb: "混合癞子炸弹",
  rocket: "王炸",
};
export const playName = (p: Play) =>
  `${bombLevel(p) && p.cards.length > 4 ? p.cards.length + "张" : ""}${names[p.kind]}${p.kind === "rocket" || p.kind === "mixedWildBomb" ? "" : " · " + rankText(p.main)}`;
const bombLevels: Partial<Record<PlayKind, number>> = {
  softBomb: 1,
  bomb: 2,
  mixedWildBomb: 3,
  wildBomb: 4,
  rocket: 100,
};
export const bombLevel = (p: Play) => {
  const tier = bombLevels[p.kind] ?? 0;
  return tier && p.kind !== "rocket" ? (p.cards.length - 4) * 4 + tier : tier;
};
export function bombFactor(mode: Mode, play: Play): number {
  if (!bombLevel(play)) return 1;
  if (mode === "standard") return 2;
  if (
    mode === "heaven-earth" &&
    (play.cards.length > 4 || play.kind === "rocket")
  )
    return 6;
  return play.kind === "softBomb" ? 2 : 4;
}
const dualWild = (wild: Wildcards) =>
  typeof wild !== "number" && !!wild && new Set(wild).size === 2;
export function beats(p: Play, previous: Play | null): boolean {
  if (!previous) return true;
  const a = bombLevel(p),
    b = bombLevel(previous);
  if (a || b) return a > b || (a === b && a > 0 && p.main > previous.main);
  return (
    p.kind === previous.kind &&
    p.cards.length === previous.cards.length &&
    p.chain === previous.chain &&
    p.main > previous.main
  );
}
const counts = (ranks: number[]) => {
  const c = new Map<number, number>();
  for (const r of ranks) c.set(r, (c.get(r) ?? 0) + 1);
  return c;
};
const consecutive = (r: number[]) =>
  r.every((v, i) => v <= 14 && (i === 0 || v === r[i - 1] + 1));

function classify(cards: Card[], as: number[], wild: Wildcards): Play[] {
  const n = cards.length,
    c = counts(as),
    ranks = [...c.keys()].sort((a, b) => a - b),
    out: Play[] = [];
  const add = (kind: PlayKind, main: number, chain = 1) =>
    out.push({ cards, as, kind, main, chain });
  if (n === 1) add("single", as[0]);
  if (n === 2 && c.has(16) && c.has(17)) add("rocket", 17);
  if (c.size === 1) {
    if (n === 2 && ranks[0] <= 15) add("pair", ranks[0]);
    if (n === 3 && ranks[0] <= 15) add("triple", ranks[0]);
    if ((n === 4 || (dualWild(wild) && n >= 5 && n <= 12)) && ranks[0] <= 15)
      add(
        cards.every((x) => isWildRank(x.rank, wild))
          ? "wildBomb"
          : cards.some((x) => isWildRank(x.rank, wild))
            ? "softBomb"
            : "bomb",
        ranks[0],
      );
  }
  if (n === 4 || n === 5)
    for (const r of ranks)
      if (c.get(r) === 3) {
        if (n === 4) add("tripleSingle", r);
        else if (c.size === 2) add("triplePair", r);
      }
  if (n >= 5 && c.size === n && consecutive(ranks))
    add("straight", ranks.at(-1)!, n);
  if (
    n >= 6 &&
    n % 2 === 0 &&
    [...c.values()].every((v) => v === 2) &&
    consecutive(ranks)
  )
    add("pairChain", ranks.at(-1)!, n / 2);
  for (const unit of [3, 4, 5]) {
    if (n % unit !== 0 || n / unit < 2) continue;
    const length = n / unit;
    for (let start = 3; start + length - 1 <= 14; start++) {
      const body = Array.from({ length }, (_, i) => start + i);
      if (!body.every((r) => c.get(r) === 3)) continue;
      const rest = new Map([...c].filter(([r]) => !body.includes(r)));
      const valid =
        unit === 3
          ? rest.size === 0
          : unit === 4
            ? [...rest.values()].reduce((s, v) => s + v, 0) === length &&
              [...rest.values()].every((v) => v < 4) &&
              !(rest.has(16) && rest.has(17))
            : rest.size === length && [...rest.values()].every((v) => v === 2);
      if (valid)
        add(
          unit === 3
            ? "airplane"
            : unit === 4
              ? "airplaneSingle"
              : "airplanePair",
          start + length - 1,
          length,
        );
    }
  }
  if (n === 6 || n === 8)
    for (const r of ranks)
      if (c.get(r) === 4) {
        const rest = new Map([...c].filter(([key]) => key !== r));
        if (n === 6 && !(rest.has(16) && rest.has(17))) add("fourSingle", r);
        if (
          n === 8 &&
          rest.size === 2 &&
          [...rest.values()].every((v) => v === 2)
        )
          add("fourPair", r);
      }
  return out;
}

/** Enumerate distinct legal interpretations of selected physical cards. Explicit assignments never get silently replaced. */
export function interpret(
  cards: Card[],
  wild: Wildcards = null,
  explicit?: number[],
): Play[] {
  if (
    !cards.length ||
    cards.length > 20 ||
    new Set(cards.map((c) => c.id)).size !== cards.length
  )
    return [];
  const indexes = cards.flatMap((c, i) =>
    isWildRank(c.rank, wild) ? [i] : [],
  );
  const natural = cards.map((c) => c.rank);
  const allWild = indexes.length === cards.length;
  const mixedBomb =
    allWild &&
    dualWild(wild) &&
    cards.length >= 4 &&
    cards.length <= 8 &&
    new Set(natural).size === 2
      ? {
          cards,
          as: natural.map(() => Math.max(...natural)),
          kind: "mixedWildBomb" as const,
          main: Math.max(...natural),
          chain: 1,
        }
      : null;
  if (explicit) {
    if (
      explicit.length !== cards.length ||
      explicit.some(
        (r, i) =>
          !Number.isInteger(r) ||
          (isWildRank(cards[i].rank, wild)
            ? r < 3 || r > 15
            : r !== cards[i].rank),
      )
    )
      return [];
    if (allWild && explicit.some((r, i) => r !== cards[i].rank))
      return mixedBomb && explicit.every((r, i) => r === mixedBomb.as[i])
        ? [mixedBomb]
        : [];
    return classify(cards, explicit, wild);
  }
  if (!indexes.length || allWild)
    return [
      ...classify(cards, natural, wild),
      ...(mixedBomb ? [mixedBomb] : []),
    ];

  // Match complete legal patterns, instead of enumerating 13^8 wildcard assignments.
  // Wing ranks never affect a play's strength, so retain one natural-first assignment
  // per kind/body. Every explicit assignment is still independently accepted above.
  const n = cards.length;
  const fixed = counts(
    cards.filter((c) => !isWildRank(c.rank, wild)).map((c) => c.rank),
  );
  const wildCounts = counts(indexes.map((i) => cards[i].rank));
  const results: Play[] = [];
  const target = (ranks: number[]) => {
    if (ranks.length !== n) return;
    const needed = counts(ranks);
    for (const [rank, count] of fixed) {
      if ((needed.get(rank) ?? 0) < count) return;
      needed.set(rank, needed.get(rank)! - count);
    }
    if ([...needed].some(([rank, count]) => rank > 15 && count > 0)) return;
    const as = [...natural];
    const remaining: number[] = [];
    for (const i of indexes) {
      if ((needed.get(cards[i].rank) ?? 0) > 0)
        needed.set(cards[i].rank, needed.get(cards[i].rank)! - 1);
      else remaining.push(i);
    }
    const missing = [...needed].flatMap(([rank, count]) =>
      Array<number>(count).fill(rank),
    );
    if (missing.length !== remaining.length) return;
    remaining.forEach((i, index) => {
      as[i] = missing[index];
    });
    results.push(...classify(cards, as, wild));
  };
  const attach = (body: number[], wingCount: number, unit: 1 | 2) => {
    if (body.length + wingCount * unit !== n) return;
    const core = counts(body);
    for (const [rank, count] of core)
      if ((fixed.get(rank) ?? 0) > count) return;
    const wings = new Map([...fixed].filter(([rank]) => !core.has(rank)));
    if (unit === 1) {
      if (
        [...wings.values()].some((count) => count > 3) ||
        (wings.has(16) && wings.has(17))
      )
        return;
      let left = wingCount - [...wings.values()].reduce((a, b) => a + b, 0);
      if (left < 0) return;
      const add = (rank: number, available: number) => {
        if (core.has(rank)) return;
        const taken = Math.min(left, available, 3 - (wings.get(rank) ?? 0));
        if (taken > 0) {
          wings.set(rank, (wings.get(rank) ?? 0) + taken);
          left -= taken;
        }
      };
      for (const [rank, count] of wildCounts) add(rank, count);
      for (let rank = 3; rank <= 15 && left; rank++) add(rank, left);
      if (left) return;
    } else {
      if (
        wings.size > wingCount ||
        [...wings].some(([rank, count]) => rank > 15 || count > 2)
      )
        return;
      for (const rank of wings.keys()) wings.set(rank, 2);
      const candidates = Array.from({ length: 13 }, (_, i) => i + 3).filter(
        (rank) => !core.has(rank) && !wings.has(rank),
      );
      candidates.sort(
        (a, b) =>
          Math.min(2, wildCounts.get(b) ?? 0) -
            Math.min(2, wildCounts.get(a) ?? 0) || a - b,
      );
      for (const rank of candidates) {
        if (wings.size === wingCount) break;
        wings.set(rank, 2);
      }
      if (wings.size !== wingCount) return;
    }
    target([
      ...body,
      ...[...wings].flatMap(([rank, count]) => Array<number>(count).fill(rank)),
    ]);
  };
  for (let rank = 3; rank <= 15; rank++) {
    if (n === 2 || n === 3 || n === 4 || (dualWild(wild) && n <= 12))
      target(Array<number>(n).fill(rank));
    attach([rank, rank, rank], 1, 1);
    attach([rank, rank, rank], 1, 2);
    attach([rank, rank, rank, rank], 2, 1);
    attach([rank, rank, rank, rank], 2, 2);
  }
  for (const unit of [1, 2, 3]) {
    const minimum = unit === 1 ? 5 : unit === 2 ? 3 : 2;
    for (
      let length = minimum;
      length <= Math.min(12, Math.floor(n / unit));
      length++
    ) {
      for (let start = 3; start + length - 1 <= 14; start++) {
        const body = Array.from({ length }, (_, i) =>
          Array<number>(unit).fill(start + i),
        ).flat();
        if (body.length === n) target(body);
        if (unit === 3) {
          attach(body, length, 1);
          attach(body, length, 2);
        }
      }
    }
  }
  const naturalCost = (p: Play) =>
    p.as.filter((r, i) => r !== cards[i].rank).length;
  results.sort(
    (a, b) =>
      naturalCost(a) - naturalCost(b) ||
      bombLevel(a) - bombLevel(b) ||
      a.main - b.main,
  );
  const seen = new Set<string>();
  return results.filter((p) => {
    const key = `${p.kind}:${p.main}:${p.chain}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function realize(
  hand: Card[],
  ranks: number[],
  wild: Wildcards,
): { cards: Card[]; as: number[] } | null {
  const cards: Card[] = [],
    as: number[] = [],
    remaining = [...hand];
  // Reserve wildcards required at their natural rank before substituting others.
  for (const r of [...ranks].sort(
    (a, b) => Number(isWildRank(b, wild)) - Number(isWildRank(a, wild)),
  )) {
    let i = remaining.findIndex((c) => c.rank === r);
    if (i < 0 && r <= 15)
      i = remaining.findIndex((c) => isWildRank(c.rank, wild));
    if (i < 0) return null;
    cards.push(remaining.splice(i, 1)[0]);
    as.push(r);
  }
  return { cards, as };
}

/** Candidate generator for hints/search; bounded wing enumeration, all candidates independently validated. */
export function legalMoves(
  hand: Card[],
  wild: Wildcards = null,
  previous: Play | null = null,
): Play[] {
  const out: Play[] = [],
    seen = new Set<string>();
  const add = (
    material: { cards: Card[]; as: number[] } | null,
    kind?: PlayKind,
  ) => {
    if (!material) return;
    for (const p of interpret(material.cards, wild, material.as)) {
      if ((kind && kind !== p.kind) || !beats(p, previous)) continue;
      const key = `${p.cards.map((c) => c.id).sort()}:${p.kind}:${p.main}:${p.chain}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
  };
  for (const c of hand) add({ cards: [c], as: [c.rank] });
  add(realize(hand, [16, 17], wild), "rocket");
  for (let r = 3; r <= 15; r++)
    for (let n = 2; n <= (dualWild(wild) ? Math.min(12, hand.length) : 4); n++)
      add(realize(hand, Array(n).fill(r), wild));
  if (dualWild(wild)) {
    const groups = [
      ...new Set(
        hand.filter((c) => isWildRank(c.rank, wild)).map((c) => c.rank),
      ),
    ].map((rank) => hand.filter((c) => c.rank === rank));
    if (groups.length === 2)
      for (let a = 1; a <= groups[0].length; a++)
        for (let b = 1; b <= groups[1].length; b++) {
          if (a + b < 4) continue;
          const cards = [...groups[0].slice(0, a), ...groups[1].slice(0, b)];
          add(
            {
              cards,
              as: cards.map(() =>
                Math.max(groups[0][0].rank, groups[1][0].rank),
              ),
            },
            "mixedWildBomb",
          );
        }
  }
  const attach = (
    body: number[],
    wingCount: number,
    unit: number,
    kind: PlayKind,
  ) => {
    if (
      previous &&
      !bombLevel(previous) &&
      (kind !== previous.kind ||
        body.length + wingCount * unit !== previous.cards.length)
    )
      return;
    const core = realize(hand, body, wild);
    if (!core) return;
    const used = new Set(core.cards.map((c) => c.id)),
      rem = hand.filter((c) => !used.has(c.id));
    let budget = 100;
    const visit = (
      available: Card[],
      chosen: Card[],
      as: number[],
      start: number,
      left: number,
    ) => {
      if (budget <= 0) return;
      if (!left) {
        budget--;
        add(
          { cards: [...core.cards, ...chosen], as: [...core.as, ...as] },
          kind,
        );
        return;
      }
      for (let r = start; r <= (unit === 1 ? 17 : 15); r++) {
        if (
          body.includes(r) ||
          (r === 17 && as.includes(16)) ||
          (unit === 1 && as.filter((x) => x === r).length >= 3)
        )
          continue;
        const next = realize(available, Array(unit).fill(r), wild);
        if (!next) continue;
        const ids = new Set(next.cards.map((c) => c.id));
        visit(
          available.filter((c) => !ids.has(c.id)),
          [...chosen, ...next.cards],
          [...as, ...next.as],
          unit === 1 ? r : r + 1,
          left - 1,
        );
      }
    };
    visit(rem, [], [], 3, wingCount);
  };
  for (let r = 3; r <= 15; r++) {
    attach([r, r, r], 1, 1, "tripleSingle");
    attach([r, r, r], 1, 2, "triplePair");
    attach([r, r, r, r], 2, 1, "fourSingle");
    attach([r, r, r, r], 2, 2, "fourPair");
  }
  for (const unit of [1, 2, 3]) {
    const min = unit === 1 ? 5 : unit === 2 ? 3 : 2;
    for (
      let length = min;
      length <= Math.min(12, Math.floor(hand.length / unit));
      length++
    )
      for (let start = 3; start + length - 1 <= 14; start++) {
        const body = Array.from({ length }, (_, i) =>
          Array(unit).fill(start + i),
        ).flat();
        add(
          realize(hand, body, wild),
          unit === 1 ? "straight" : unit === 2 ? "pairChain" : "airplane",
        );
        if (unit === 3 && length * 4 <= hand.length)
          attach(body, length, 1, "airplaneSingle");
        if (unit === 3 && length * 5 <= hand.length)
          attach(body, length, 2, "airplanePair");
      }
  }
  return out.sort(
    (a, b) =>
      bombLevel(a) - bombLevel(b) ||
      a.main - b.main ||
      a.cards.length - b.cards.length,
  );
}

export function bottomBonus(
  cards: Card[],
): { factor: number; reason: string } | null {
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b),
    kings = ranks.filter((r) => r >= 16).length;
  const sameSuit = cards.every((c) => c.suit === cards[0].suit) && !kings;
  const run = new Set(ranks).size === 3 && consecutive(ranks);
  if (kings === 2) return { factor: 4, reason: "底牌双王" };
  if (new Set(ranks).size === 1) return { factor: 4, reason: "底牌三条" };
  if (sameSuit && run) return { factor: 4, reason: "底牌同花顺" };
  if (kings) return { factor: 2, reason: "底牌单王" };
  if (sameSuit) return { factor: 2, reason: "底牌同花" };
  if (run) return { factor: 2, reason: "底牌顺子" };
  return null;
}
