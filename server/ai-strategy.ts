import type {
  Card,
  Difficulty,
  GameAction,
  Personality,
  Play,
} from "../shared/types.ts";
import type { AiObservation } from "./ai.ts";
import { deck, isWildRank } from "../shared/cards.ts";
import { beats, bombLevel, legalMoves, playName } from "../shared/rules.ts";
import { HandPlanner, rankCounts, roughTurns } from "./ai-planner.ts";

type Decision = { action: GameAction; explanation: string };
const profiles = {
  cautious: { bid: 9.2, double: 12, spend: 1.25, seize: 0.6, risk: 0.6 },
  balanced: { bid: 7.9, double: 10.8, spend: 0.9, seize: 1.1, risk: 0.3 },
  bold: { bid: 6.8, double: 9.5, spend: 0.6, seize: 1.8, risk: 0.1 },
};
const without = (hand: Card[], play: Play) => {
  const ids = new Set(play.cards.map((c) => c.id));
  return hand.filter((c) => !ids.has(c.id));
};
const actionFor = (p: Play): GameAction => ({
  type: "play",
  cardIds: p.cards.map((c) => c.id),
  as: p.as,
  kind: p.kind,
  main: p.main,
});
const sameTeam = (a: number, b: number, landlord: number) =>
  (a === landlord) === (b === landlord);

/** Public-card determinizations, never actual opponents' hands. Bottom cards
 * still held are assigned to the landlord, and every sample respects hand sizes. */
export function publicDeals(obs: AiObservation, count: number): Card[][][] {
  const played = new Set(obs.played.map((c) => c.id));
  const known = new Set(
    [...obs.hand, ...obs.played, ...obs.bottom].map((c) => c.id),
  );
  const pool = deck().filter((c) => !known.has(c.id));
  const fixed =
    obs.landlord !== obs.seat
      ? obs.bottom.filter((c) => !played.has(c.id))
      : [];
  let seed = 2166136261;
  for (const id of [...known].sort())
    for (const c of id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  seed ^= obs.seat + (obs.landlord + 1) * 19;
  if (!seed) seed = 1;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => {
    const cards = [...pool];
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    let offset = 0;
    return [0, 1, 2].map((seat) => {
      if (seat === obs.seat) return obs.hand;
      const bottom = seat === obs.landlord ? fixed : [];
      const n = Math.max(0, obs.counts[seat] - bottom.length);
      const hand = [...bottom, ...cards.slice(offset, offset + n)];
      offset += n;
      return hand;
    });
  });
}

function material(hand: Card[], obs: AiObservation) {
  const c = rankCounts(hand);
  return (
    c[14] * 3.7 +
    c[13] * 2.5 +
    c[12] * 1.4 +
    c[11] * 0.5 +
    c.reduce((s, n) => s + (n === 4 ? 3.5 : n === 3 ? 1.2 : 0), 0) +
    (c[13] && c[14] ? 2.3 : 0) +
    hand.filter((c) => isWildRank(c.rank, obs.wildRank)).length * 1.4
  );
}
function spent(play: Play, obs: AiObservation) {
  const before = rankCounts(obs.hand),
    used = rankCounts(play.cards);
  let value = play.cards.reduce(
    (sum, c) =>
      sum +
      (c.rank === 17
        ? 2.4
        : c.rank === 16
          ? 1.8
          : c.rank === 15
            ? 0.8
            : c.rank === 14
              ? 0.25
              : 0),
    0,
  );
  for (let i = 0; i < 15; i++)
    if (used[i] && used[i] < before[i])
      value += before[i] === 4 ? 1.7 : before[i] === 3 ? 0.5 : 0.2;
  if (bombLevel(play)) value += 2.8;
  return value;
}

type Sample = { hands: Card[][]; moves: Play[][] };
type Threat = { hold: number; lose: number; feed: number };
function threats(
  play: Play | null,
  obs: AiObservation,
  samples: Sample[],
): Threat {
  let hold = 0,
    lose = 0,
    feed = 0;
  const leader = play ? obs.seat : obs.trick!.seat;
  const target = play ?? obs.trick!.play;
  for (const sample of samples) {
    let safe = true,
      lost = false,
      fed = false;
    const earlier: { seat: number; replies: Play[] }[] = [];
    // Only seats that still act before this trick closes get an immediate reply.
    for (let i = 1; i < 3; i++) {
      const seat = (obs.seat + i) % 3;
      if (seat === leader) break;
      const replies = sample.moves[seat].filter((p) => beats(p, target));
      const finishes = replies.filter(
        (p) => p.cards.length === sample.hands[seat].length,
      );
      if (!sameTeam(seat, obs.seat, obs.landlord)) {
        if (replies.length) safe = false;
        const partnerCanBlock = earlier.some(
          (e) =>
            sameTeam(e.seat, obs.seat, obs.landlord) &&
            e.replies.some((block) => finishes.every((p) => !beats(p, block))),
        );
        if (!fed && finishes.length && !partnerCanBlock) lost = true;
      } else {
        const enemyCanBlock = earlier.some(
          (e) =>
            !sameTeam(e.seat, obs.seat, obs.landlord) &&
            e.replies.some((block) => finishes.every((p) => !beats(p, block))),
        );
        if (!lost && finishes.length && !enemyCanBlock) fed = true;
      }
      earlier.push({ seat, replies });
    }
    hold += Number(safe);
    lose += Number(lost);
    feed += Number(fed);
  }
  return {
    hold: hold / samples.length,
    lose: lose / samples.length,
    feed: feed / samples.length,
  };
}

type Position = {
  hands: Card[][];
  turn: number;
  trick: { seat: number; play: Play } | null;
  passes: number;
};
function advance(state: Position, play: Play | null): Position {
  const hands = [...state.hands];
  if (play) hands[state.turn] = without(hands[state.turn], play);
  const passes = play ? 0 : state.passes + 1;
  return {
    hands,
    turn: (state.turn + 1) % 3,
    trick:
      passes === 2 ? null : play ? { seat: state.turn, play } : state.trick,
    passes: passes === 2 ? 0 : passes,
  };
}
function terminalValue(state: Position, obs: AiObservation): number | null {
  const me = obs.seat === obs.landlord;
  if (!state.hands[obs.landlord].length) return me ? 1000 : -1000;
  if (state.hands.some((hand, seat) => seat !== obs.landlord && !hand.length))
    return me ? -1000 : 1000;
  return null;
}

/** Team minimax in sampled *possible* deals. Each root action receives the
 * same node allowance; only complete sample rounds contribute to the decision. */
function searchScores(
  choices: (Play | null)[],
  obs: AiObservation,
  samples: Sample[],
  deadline: number,
): number[] | null {
  const endgame = obs.counts.reduce((s, n) => s + n, 0) <= 18;
  const totals = choices.map(() => 0);
  let rounds = 0;
  for (const sample of samples.slice(0, endgame ? 6 : 3)) {
    const memoMoves = new Map<string, Play[]>();
    const burdenCache = new Map<string, number>();
    const planners = sample.hands.map(
      (h, s) => new HandPlanner(h, obs.wildRank, 0, Infinity, sample.moves[s]),
    );
    for (let s = 0; s < 3; s++)
      memoMoves.set(
        sample.hands[s]
          .map((c) => c.id)
          .sort()
          .join(","),
        sample.moves[s],
      );
    const evaluate = (state: Position) => {
      const terminal = terminalValue(state, obs);
      if (terminal !== null) return terminal;
      const burden = state.hands.map((h, s) => {
        const key = h
          .map((c) => c.id)
          .sort()
          .join(",");
        let value = burdenCache.get(key);
        if (value === undefined) {
          value =
            planners[s].cost(h) * 5 + h.length * 0.2 - material(h, obs) * 0.25;
          burdenCache.set(key, value);
        }
        return value;
      });
      const margin =
        Math.min(...burden.filter((_, s) => s !== obs.landlord)) -
        burden[obs.landlord];
      return (
        (obs.seat === obs.landlord ? margin : -margin) +
        (sameTeam(state.turn, obs.seat, obs.landlord) ? 1 : -1)
      );
    };
    const round: number[] = [];
    for (const choice of choices) {
      let nodes = 0;
      const search = (
        state: Position,
        depth: number,
        alpha: number,
        beta: number,
      ): number => {
        const value = evaluate(state);
        if (
          Math.abs(value) === 1000 ||
          depth === 0 ||
          ++nodes > (endgame ? 300 : 42) ||
          performance.now() >= deadline
        )
          return value;
        const hand = state.hands[state.turn],
          key = hand
            .map((c) => c.id)
            .sort()
            .join(",");
        let all = memoMoves.get(key);
        if (!all) {
          all = legalMoves(hand, obs.wildRank);
          memoMoves.set(key, all);
        }
        const previous = state.trick?.play ?? null;
        const moves = all.filter((p) => beats(p, previous));
        if (moves.some((p) => p.cards.length === hand.length))
          return sameTeam(state.turn, obs.seat, obs.landlord) ? 1000 : -1000;
        const max = sameTeam(state.turn, obs.seat, obs.landlord);
        // Preserve finishing, blocking, long and cheap moves within a bounded beam.
        const ranked = moves
          .map((p) => ({
            p,
            v:
              roughTurns(without(hand, p)) * 5 +
              spent(p, { ...obs, hand }) * 0.2,
          }))
          .sort((a, b) => a.v - b.v);
        const options: (Play | null)[] = ranked
          .slice(0, endgame ? 8 : 4)
          .map((x) => x.p);
        if (previous) options.push(null);
        let best = max ? -Infinity : Infinity;
        for (const play of options) {
          const v = search(advance(state, play), depth - 1, alpha, beta);
          best = max ? Math.max(best, v) : Math.min(best, v);
          if (max) alpha = Math.max(alpha, best);
          else beta = Math.min(beta, best);
          if (alpha >= beta) break;
        }
        return Number.isFinite(best) ? best : value;
      };
      const passes = obs.trick && (obs.trick.seat + 1) % 3 !== obs.seat ? 1 : 0;
      const initial: Position = {
        hands: sample.hands,
        turn: obs.seat,
        trick: obs.trick,
        passes,
      };
      round.push(
        search(advance(initial, choice), endgame ? 10 : 4, -Infinity, Infinity),
      );
      if (performance.now() >= deadline)
        return rounds ? totals.map((v) => v / rounds) : null;
    }
    round.forEach((v, i) => (totals[i] += v));
    rounds++;
  }
  return rounds ? totals.map((v) => v / rounds) : null;
}

export function chooseStrategicAction(
  obs: AiObservation,
  personality: Personality,
  difficulty: Exclude<Difficulty, "dazed">,
): Decision {
  const fierce = difficulty === "fierce",
    cfg = profiles[personality];
  const started = performance.now(),
    deadline = started + (fierce ? 180 : 100);
  const all = legalMoves(obs.hand, obs.wildRank);
  const planner = new HandPlanner(
    obs.hand,
    obs.wildRank,
    fierce ? 1800 : 550,
    started + (fierce ? 65 : 35),
    all,
  );
  if (obs.phase !== "playing") {
    const plan = planner.cost(obs.hand);
    const power = material(obs.hand, obs) + (7 - plan) * 1.65;
    const threshold =
      obs.phase === "bidding"
        ? cfg.bid + (obs.bidStage === "rob" ? 1.8 : 0)
        : cfg.double + (obs.seat !== obs.landlord ? 0.8 : 0);
    const yes = power >= threshold;
    return {
      action: { type: obs.phase === "bidding" ? "bid" : "double", yes },
      explanation: `结合控牌与拆牌规划（约 ${Math.round(plan)} 手），${yes ? "主动争取收益。" : "保留余地，稳妥应对。"}`,
    };
  }
  const previous =
    obs.trick && obs.trick.seat !== obs.seat ? obs.trick.play : null;
  const moves = all.filter((p) => beats(p, previous));
  const winning = moves.find((p) => p.cards.length === obs.hand.length);
  if (winning)
    return {
      action: actionFor(winning),
      explanation: "可以一手出完，立即收尾。",
    };
  if (!moves.length)
    return {
      action: { type: "pass" },
      explanation: "没有合法接牌，保留手牌等待下一轮。",
    };
  const enemySeats = [0, 1, 2].filter(
    (s) => !sameTeam(s, obs.seat, obs.landlord),
  );
  const danger = Math.min(...enemySeats.map((s) => obs.counts[s]));
  const partner = [0, 1, 2].find(
    (s) => s !== obs.seat && sameTeam(s, obs.seat, obs.landlord),
  );
  const partnerLeading =
    !!previous && sameTeam(obs.trick!.seat, obs.seat, obs.landlord);
  const economy = danger <= 2 ? 0.12 : danger <= 5 ? 0.45 : 1;
  const candidates = moves
    .map((play) => {
      const rest = without(obs.hand, play);
      return {
        play,
        rest,
        score:
          -roughTurns(rest) * 4 +
          play.cards.length * 0.12 -
          spent(play, obs) * cfg.spend * economy,
      };
    })
    .sort((a, b) => b.score - a.score);
  // Dedupe equivalent rank consumptions and interpretations before allocating work.
  const seen = new Set<string>();
  const shortlist = candidates
    .filter((c) => {
      const key =
        rankCounts(c.play.cards).join("") +
        ":" +
        c.play.kind +
        ":" +
        c.play.main;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, fierce ? 64 : 40);
  const samples: Sample[] = [];
  for (const hands of publicDeals(obs, fierce ? 10 : 6)) {
    samples.push({
      hands,
      moves: hands.map((h, s) =>
        s === obs.seat ? all : legalMoves(h, obs.wildRank),
      ),
    });
    if (performance.now() >= deadline - 25) break;
  }
  const before = planner.cost(obs.hand);
  const options = shortlist
    .map((c) => {
      const after = planner.cost(c.rest),
        risk = threats(c.play, obs, samples);
      let score =
        (before - after) * 5 +
        c.play.cards.length * 0.13 -
        spent(c.play, obs) * cfg.spend * economy;
      score +=
        risk.hold * (after <= 1.14 ? 11 : after <= 2.3 ? 4.2 : cfg.seize);
      score -= risk.lose * (45 + cfg.risk * 15);
      score += risk.feed * 28;
      if (previous && !partnerLeading)
        score += cfg.seize + (danger <= 3 ? 3 : 0);
      if (partnerLeading) score -= 7 + (obs.counts[partner!] <= 2 ? 10 : 0);
      // Don't feed a one-/two-card enemy their preferred size. A known unbeatable
      // stopper may still be better and is accounted for by the sampled hold rate.
      if (!previous && danger <= 2 && c.play.cards.length === danger)
        score -= (1 - risk.hold) * 12;
      return { ...c, score, after, risk };
    })
    .sort((a, b) => b.score - a.score);
  const passRisk = previous ? threats(null, obs, samples) : null;
  const passScore = passRisk
    ? (partnerLeading ? 2.5 : -cfg.seize) -
      passRisk.lose * 55 +
      passRisk.feed * 28 -
      (!partnerLeading && danger <= 2 ? 9 : 0)
    : -Infinity;
  const finalists: { play: Play | null; score: number }[] = options.slice(
    0,
    obs.counts.reduce((s, n) => s + n, 0) <= 18 ? 7 : 5,
  );
  if (previous) finalists.push({ play: null, score: passScore });
  let searched = false;
  if (fierce) {
    const scores = searchScores(
      finalists.map((c) => c.play),
      obs,
      samples,
      deadline,
    );
    if (scores) {
      scores.forEach(
        (v, i) =>
          (finalists[i].score +=
            v * (obs.counts.reduce((s, n) => s + n, 0) <= 18 ? 0.065 : 0.18)),
      );
      searched = true;
    }
  }
  finalists.sort((a, b) => b.score - a.score);
  const best = finalists[0].play;
  if (!best)
    return {
      action: { type: "pass" },
      explanation: partnerLeading
        ? "队友掌握牌权，留出收尾空间。"
        : "接牌会消耗关键控制，等待更合适的时机。",
    };
  const choice = options.find((c) => c.play === best)!;
  const reason =
    choice.risk.feed > 0.5
      ? "给队友创造收尾机会"
      : danger <= 2
        ? "封住对手的收尾路线"
        : choice.risk.hold > 0.7 && choice.after <= 2.3
          ? "控制牌权，衔接收尾"
          : `整理为约 ${Math.round(choice.after)} 手，保留后续接力`;
  return {
    action: actionFor(best),
    explanation: `${searched ? (obs.counts.reduce((s, n) => s + n, 0) <= 18 ? "结合残局推演，" : "推演后续应对，") : ""}用${playName(best)}${reason}。`,
  };
}
