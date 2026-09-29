import type { Card, Suit } from "./types.ts";
export const rankText = (rank: number) =>
  ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "小王", 17: "大王" })[
    rank
  ] ?? String(rank);
export const suitText: Record<Suit, string> = {
  S: "♠",
  H: "♥",
  C: "♣",
  D: "♦",
  J: "✦",
};
export const sortCards = (cards: Card[]) =>
  [...cards].sort((a, b) => b.rank - a.rank || a.suit.localeCompare(b.suit));
export function deck(): Card[] {
  const cards: Card[] = [];
  for (let rank = 3; rank <= 15; rank++)
    for (const suit of ["S", "H", "C", "D"] as Suit[])
      cards.push({ id: `${rank}${suit}`, rank, suit });
  return [
    ...cards,
    { id: "16J", rank: 16, suit: "J" },
    { id: "17J", rank: 17, suit: "J" },
  ];
}
export function formatTokens(value: string | bigint) {
  const n = BigInt(value),
    a = n < 0n ? -n : n,
    sign = n < 0n ? "−" : "";
  for (const [unit, size] of [
    ["T", 1_000_000_000_000n],
    ["B", 1_000_000_000n],
    ["M", 1_000_000n],
    ["K", 1000n],
  ] as const) {
    if (a >= size)
      return `${sign}${a / size}${(a % size) / (size / 10n) ? "." + (a % size) / (size / 10n) : ""} ${unit}`;
  }
  return `${sign}${a}`;
}
