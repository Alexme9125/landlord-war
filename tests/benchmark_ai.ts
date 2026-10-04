/** Reproducible paired-deal strength probe. No server, wallets, or hidden AI input.
 * AI_SEEDS=12 node --import tsx tests/benchmark_ai.ts */
import { chooseAction, type AiObservation } from "../server/ai.ts";
import { deck, gameWildRanks } from "../shared/cards.ts";
import { createGame, applyAction } from "../shared/engine.ts";
import type { Difficulty, GameState, Mode, Card } from "../shared/types.ts";
export function shuffled(seed: number): Card[] {
  let x = seed | 0;
  const random = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
  const out = deck();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function observe(g: GameState, seat: number): AiObservation {
  return {
    hand: g.hands[seat],
    wildRank: g.landlord < 0 ? g.heavenRank : gameWildRanks(g),
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
export function match(mode: Mode, seed: number, tiers: Difficulty[]) {
  let g = createGame(
    "benchmark",
    mode,
    shuffled(seed),
    0,
    mode === "standard" ? null : 7,
    10,
    mode === "heaven-earth" ? 9 : null,
  );
  // Fix the landlord across paired deals, so bidding and lucky seat draws cannot
  // account for strength differences. Normal engine actions handle every move.
  while (g.phase === "bidding")
    g = applyAction(g, g.turn, { type: "bid", yes: g.turn === 0 });
  for (let seat = 0; seat < 3; seat++)
    g = applyAction(g, seat, { type: "double", yes: false });
  let maxMs = 0,
    decisions = 0;
  while (g.phase === "playing" && decisions < 240) {
    const started = performance.now();
    const decision = chooseAction(
      observe(g, g.turn),
      "balanced",
      tiers[g.turn],
    );
    maxMs = Math.max(maxMs, performance.now() - started);
    g = applyAction(g, g.turn, decision.action);
    decisions++;
  }
  if (g.phase !== "finished") throw new Error("Match failed to terminate");
  return { winner: g.winner, maxMs, decisions };
}
if (process.argv[1]?.endsWith("benchmark_ai.ts")) {
  const seeds = Number(process.env.AI_SEEDS ?? 12);
  for (const [a, b] of [
    ["gentle", "dazed"],
    ["fierce", "dazed"],
    ["fierce", "gentle"],
  ] as [Difficulty, Difficulty][]) {
    let wins = 0,
      total = 0,
      maxMs = 0;
    const modes: Mode[] = ["standard", "wild", "heaven-earth"];
    for (const mode of modes) {
      let modeWins = 0;
      for (let i = 0; i < seeds; i++)
        for (const advancedLandlord of [true, false]) {
          const tiers: Difficulty[] = advancedLandlord ? [a, b, b] : [b, a, a];
          const result = match(
            mode,
            Number(process.env.AI_SEED_START ?? 31001) + i * 101,
            tiers,
          );
          const won = (result.winner === "landlord") === advancedLandlord;
          wins += Number(won);
          modeWins += Number(won);
          total++;
          maxMs = Math.max(maxMs, result.maxMs);
        }
      console.log(
        JSON.stringify({ a, b, mode, wins: modeWins, total: seeds * 2 }),
      );
    }
    console.log(
      JSON.stringify({ a, b, wins, total, maxMs: Math.round(maxMs) }),
    );
  }
}
