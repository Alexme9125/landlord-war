import type { Card, GameAction, GameState, Mode, Play } from "./types.ts";
import { parseBaseStake, type BaseStake } from "./types.ts";
import { sortCards } from "./cards.ts";
import { beats, bombLevel, bottomBonus, interpret, playName } from "./rules.ts";

export function createGame(
  id: string,
  mode: Mode,
  shuffled: Card[],
  first: number,
  wildRank: number | null,
  baseStake: BaseStake = 10,
): GameState {
  if (shuffled.length !== 54 || new Set(shuffled.map((c) => c.id)).size !== 54)
    throw new Error("牌组无效");
  const hands = [0, 1, 2].map((seat) =>
    sortCards(shuffled.slice(seat * 17, seat * 17 + 17)),
  );
  return {
    id,
    mode,
    baseStake: parseBaseStake(baseStake),
    phase: "bidding",
    hands,
    initialHands: structuredClone(hands),
    bottom: shuffled.slice(51),
    wildRank: mode === "wild" ? wildRank : null,
    landlord: -1,
    turn: first,
    doubles: [null, null, null],
    bidding: {
      stage: "call",
      first,
      caller: -1,
      candidate: -1,
      passed: [],
      pending: [],
      called: 0,
    },
    multiplier: "15",
    multiplierEvents: [{ reason: "基础倍数", factor: 1, value: "15" }],
    trick: null,
    passes: 0,
    playedCounts: [0, 0, 0],
    events: [],
    winner: null,
  };
}
function multiply(g: GameState, factor: number, reason: string) {
  g.multiplier = (BigInt(g.multiplier) * BigInt(factor)).toString();
  g.multiplierEvents.push({ reason, factor, value: g.multiplier });
}
function event(
  g: GameState,
  seat: number,
  type: string,
  text: string,
  play?: Play,
) {
  g.events.push({
    index: g.events.length,
    seat,
    type,
    text,
    play,
    multiplier: g.multiplier,
  });
}
function assignLandlord(g: GameState) {
  g.landlord = g.bidding.candidate;
  g.hands[g.landlord] = sortCards([...g.hands[g.landlord], ...g.bottom]);
  g.phase = "doubling";
  g.turn = g.landlord;
  const bonus = bottomBonus(g.bottom);
  if (bonus) multiply(g, bonus.factor, bonus.reason);
  event(g, g.landlord, "landlord", "成为地主，收取底牌");
}
export function applyAction(
  state: GameState,
  seat: number,
  action: GameAction,
): GameState {
  if (
    !action ||
    typeof action !== "object" ||
    !["bid", "double", "play", "pass"].includes(action.type)
  )
    throw new Error("操作格式无效");
  if (
    (action.type === "bid" || action.type === "double") &&
    typeof action.yes !== "boolean"
  )
    throw new Error("请选择有效操作");
  if (
    action.type === "play" &&
    action.as !== undefined &&
    !Array.isArray(action.as)
  )
    throw new Error("牌型解释无效");
  const g = structuredClone(state);
  if (!Number.isInteger(seat) || seat < 0 || seat > 2)
    throw new Error("请先坐下");
  if (g.phase === "finished" || g.phase === "redeal")
    throw new Error("本局已经结束");
  if (action.type === "double") {
    if (g.phase !== "doubling" || g.doubles[seat] !== null)
      throw new Error("现在不能加倍");
    g.doubles[seat] = action.yes ? 2 : 1;
    // Choices are kept private until all players have chosen, including in the event stream.
    if (g.doubles.every((v) => v !== null)) {
      for (let i = 0; i < 3; i++)
        event(g, i, "double", g.doubles[i] === 2 ? "主动加倍 ×2" : "不加倍");
      g.phase = "playing";
      g.turn = g.landlord;
    }
    return g;
  }
  if (g.turn !== seat) throw new Error("还没轮到你");
  if (action.type === "bid") {
    if (g.phase !== "bidding") throw new Error("叫抢阶段已结束");
    const b = g.bidding;
    if (b.stage === "call") {
      event(g, seat, "bid", action.yes ? "叫地主" : "不叫");
      b.called++;
      if (!action.yes) {
        b.passed.push(seat);
        if (b.called === 3) g.phase = "redeal";
        else g.turn = (seat + 1) % 3;
      } else {
        b.caller = seat;
        b.candidate = seat;
        b.stage = "rob";
        b.pending = [(seat + 1) % 3, (seat + 2) % 3].filter(
          (s) => !b.passed.includes(s),
        );
        if (!b.pending.length) assignLandlord(g);
        else g.turn = b.pending.shift()!;
      }
    } else {
      if (action.yes) {
        b.candidate = seat;
        multiply(g, 2, "抢地主");
      }
      event(g, seat, "bid", action.yes ? "抢地主 ×2" : "不抢");
      if (b.pending.length) g.turn = b.pending.shift()!;
      else if (seat !== b.caller && b.candidate !== b.caller) g.turn = b.caller;
      else assignLandlord(g);
    }
    return g;
  }
  if (g.phase !== "playing") throw new Error("尚未开始出牌");
  if (action.type === "pass") {
    if (!g.trick || g.trick.seat === seat) throw new Error("领出时必须出牌");
    g.passes++;
    event(g, seat, "pass", "不出");
    if (g.passes === 2) {
      g.turn = g.trick.seat;
      g.trick = null;
      g.passes = 0;
    } else g.turn = (seat + 1) % 3;
    return g;
  }
  if (action.type === "play") {
    if (
      !Array.isArray(action.cardIds) ||
      !action.cardIds.length ||
      action.cardIds.length > 20 ||
      action.cardIds.some((id) => typeof id !== "string") ||
      new Set(action.cardIds).size !== action.cardIds.length
    )
      throw new Error("请选择有效手牌");
    const hand = g.hands[seat],
      cards = action.cardIds.map((id) => hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new Error("所选牌不在你的手中");
    const candidates = interpret(cards as Card[], g.wildRank, action.as).filter(
      (p) => beats(p, g.trick?.play ?? null),
    );
    if (!candidates.length) throw new Error("牌型无效或不能压过上一手");
    if (!action.as && candidates.length > 1)
      throw new Error("请选择癞子的牌型解释");
    const play = candidates[0];
    g.hands[seat] = hand.filter((c) => !action.cardIds.includes(c.id));
    g.playedCounts[seat]++;
    g.trick = { seat, play };
    g.passes = 0;
    if (bombLevel(play))
      multiply(
        g,
        g.mode === "wild" && play.kind !== "softBomb" ? 4 : 2,
        playName(play).split(" · ")[0],
      );
    event(g, seat, "play", playName(play), play);
    if (!g.hands[seat].length) {
      g.winner = seat === g.landlord ? "landlord" : "farmers";
      g.phase = "finished";
      if (
        g.winner === "landlord" &&
        g.playedCounts.every((count, i) => i === g.landlord || count === 0)
      ) {
        multiply(g, 2, "春天");
        event(g, seat, "spring", "春天 ×2");
      }
      if (g.winner === "farmers" && g.playedCounts[g.landlord] === 1) {
        multiply(g, 2, "反春天");
        event(g, seat, "spring", "反春天 ×2");
      }
    } else g.turn = (seat + 1) % 3;
    return g;
  }
  throw new Error("不支持的操作");
}
export function forfeit(state: GameState, seat: number): GameState {
  const g = structuredClone(state);
  if (g.landlord < 0) {
    g.phase = "finished";
    g.winner = null;
    event(g, seat, "abort", "确定地主前退出，本局作废");
    return g;
  }
  g.winner = seat === g.landlord ? "farmers" : "landlord";
  g.phase = "finished";
  // Unrevealed/unfinished double choices do not influence a forfeit.
  if (g.doubles.some((v) => v === null)) g.doubles = [1, 1, 1];
  event(g, seat, "forfeit", "离开对局，所属阵营判负");
  return g;
}
