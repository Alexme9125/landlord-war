import type {
  Card,
  GameAction,
  Personality,
  Play,
  Wildcards,
} from "../shared/types.ts";
import { deck } from "../shared/cards.ts";
import { beats, bombLevel, legalMoves, playName } from "../shared/rules.ts";

/** Everything the computer is allowed to know. In particular, no other hand is accepted. */
export interface AiObservation {
  hand: Card[];
  wildRank: Wildcards;
  seat: number;
  landlord: number;
  counts: number[];
  trick: { seat: number; play: Play } | null;
  phase: "bidding" | "doubling" | "playing";
  bidStage: "call" | "rob";
  played: Card[];
  bottom: Card[];
}

const style: Record<
  Personality,
  {
    bid: number;
    rob: number;
    double: number;
    control: number;
    bomb: number;
    contest: number;
  }
> = {
  cautious: {
    bid: 8.6,
    rob: 10.4,
    double: 10.8,
    control: 1.6,
    bomb: 7.5,
    contest: 1.6,
  },
  balanced: {
    bid: 7.5,
    rob: 9.1,
    double: 9.5,
    control: 1.25,
    bomb: 5.5,
    contest: 2.1,
  },
  bold: {
    bid: 6.5,
    rob: 8.0,
    double: 8.4,
    control: 0.9,
    bomb: 3.7,
    contest: 2.7,
  },
};

const ranks = (cards: Card[]) => {
  const count = Array<number>(18).fill(0);
  for (const card of cards) count[card.rank]++;
  return count;
};

function strength(hand: Card[], wild: Wildcards): number {
  const c = ranks(hand);
  let value = c[17] * 4.1 + c[16] * 3.1 + c[15] * 1.5 + c[14] * 0.7;
  for (let r = 3; r <= 15; r++) {
    if (c[r] >= 4) value += 3.6;
    else if (c[r] === 3) value += 1.3;
  }
  if (c[16] && c[17]) value += 2;
  let run = 0;
  for (let r = 3; r <= 14; r++) {
    run = c[r] ? run + 1 : 0;
    if (run === 5) value += 0.8;
  }
  const wildRanks = typeof wild === "number" ? [wild] : (wild ?? []);
  for (const rank of new Set(wildRanks)) value += c[rank] * 0.9;
  return value;
}

/** Fast, deliberately approximate number of leads needed to empty a hand. */
function estimatedTurns(hand: Card[]): number {
  const c = ranks(hand);
  let turns = 0;
  // Take chains where they save the most individual groups. A fixed loop keeps work bounded.
  for (const [unit, minimum] of [
    [3, 2],
    [2, 3],
    [1, 5],
  ] as const) {
    for (let round = 0; round < 4; round++) {
      let bestStart = -1,
        bestEnd = -1;
      for (let start = 3; start <= 14; start++) {
        if (c[start] < unit) continue;
        let end = start;
        while (end + 1 <= 14 && c[end + 1] >= unit) end++;
        if (end - start + 1 >= minimum && end - start > bestEnd - bestStart) {
          bestStart = start;
          bestEnd = end;
        }
        start = end;
      }
      if (bestStart < 0) break;
      for (let r = bestStart; r <= bestEnd; r++) c[r] -= unit;
      turns++;
    }
  }
  let triples = 0,
    wings = 0;
  for (let r = 3; r <= 17; r++) {
    if (!c[r]) continue;
    turns++;
    if (c[r] === 3) triples++;
    else if (c[r] <= 2) wings++;
  }
  if (c[16] && c[17]) turns--;
  return Math.max(0, turns - Math.min(triples, wings));
}

function unseenCounts(obs: AiObservation): number[] {
  const known = new Set(
    [...obs.hand, ...obs.played, ...obs.bottom].map((c) => c.id),
  );
  const out = Array<number>(18).fill(0);
  for (const c of deck()) if (!known.has(c.id)) out[c.rank]++;
  return out;
}

function control(play: Play, unseen: number[]): number {
  if (bombLevel(play)) return 1;
  let threats = 0;
  const unit =
    play.kind === "pair" || play.kind === "pairChain"
      ? 2
      : play.kind === "triple" ||
          play.kind === "tripleSingle" ||
          play.kind === "triplePair" ||
          play.kind === "airplane" ||
          play.kind === "airplaneSingle" ||
          play.kind === "airplanePair"
        ? 3
        : 1;
  for (let r = play.main + 1; r <= (play.chain > 1 ? 14 : 17); r++) {
    if (unseen[r] >= unit) threats++;
  }
  return 1 / (1 + threats * (play.chain > 1 ? 0.8 : 0.5));
}

/**
 * Fixed search budget for every personality: six public-information deals,
 * at most two sampled opponent hands per deal. legalMoves bounds wing enumeration.
 * Later scoring inspects 320 own moves and the two-turn check scans 240 moves.
 */
function sampledResponses(obs: AiObservation): Play[][][] {
  const known = new Set(
    [...obs.hand, ...obs.played, ...obs.bottom].map((c) => c.id),
  );
  const unknown = deck().filter((c) => !known.has(c.id));
  const otherSeats = [0, 1, 2].filter((seat) => seat !== obs.seat);
  const played = new Set(obs.played.map((c) => c.id));
  const heldBottom =
    obs.landlord !== obs.seat && obs.landlord >= 0
      ? obs.bottom.filter((c) => !played.has(c.id))
      : [];
  let hash = 2166136261;
  for (const c of [
    ...obs.hand,
    ...obs.played,
    ...obs.bottom,
    ...(obs.trick?.play.cards ?? []),
  ]) {
    for (let i = 0; i < c.id.length; i++)
      hash = Math.imul(hash ^ c.id.charCodeAt(i), 16777619);
  }
  hash ^= obs.seat + (obs.landlord + 1) * 7;
  const random = () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    return (hash >>> 0) / 0x100000000;
  };
  const samples: Play[][][] = [];
  for (let sample = 0; sample < 6; sample++) {
    const pool = [...unknown];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let offset = 0;
    const responses: Play[][] = [];
    for (const seat of otherSeats) {
      const fixed = seat === obs.landlord ? heldBottom : [];
      const size = Math.max(
        0,
        Math.min(pool.length - offset, (obs.counts[seat] ?? 0) - fixed.length),
      );
      const hand = [...fixed, ...pool.slice(offset, offset + size)];
      offset += size;
      responses.push(legalMoves(hand, obs.wildRank));
    }
    samples.push(responses);
  }
  return samples;
}

function sampledControl(
  play: Play,
  samples: Play[][][],
  obs: AiObservation,
): number {
  let survived = 0;
  const seats = [0, 1, 2].filter((seat) => seat !== obs.seat);
  for (const opponents of samples) {
    const beatable = opponents.some((moves, index) => {
      // A farmer's partner may technically overtake, but is not an adversary.
      if (obs.seat !== obs.landlord && seats[index] !== obs.landlord)
        return false;
      return moves.some((move) => beats(move, play));
    });
    if (!beatable) survived++;
  }
  return survived / samples.length;
}

function cardCost(play: Play, hand: Card[], personality: Personality): number {
  const cfg = style[personality];
  const selected = new Set(play.cards.map((c) => c.id));
  const before = ranks(hand),
    after = ranks(hand.filter((c) => !selected.has(c.id)));
  let cost = 0;
  for (let r = 3; r <= 17; r++) {
    if (before[r] >= 2 && after[r] > 0 && after[r] < before[r])
      cost += before[r] >= 4 ? 2.0 : before[r] === 3 ? 1.05 : 0.55;
  }
  cost += play.cards.reduce(
    (sum, c) =>
      sum +
      (c.rank >= 16 ? 1.35 : c.rank === 15 ? 0.65 : c.rank === 14 ? 0.25 : 0),
    0,
  );
  cost += play.as.reduce(
    (sum, as, i) => sum + (as !== play.cards[i].rank ? 0.18 : 0),
    0,
  );
  if (bombLevel(play)) cost += cfg.bomb;
  return cost;
}

function candidateScore(
  play: Play,
  obs: AiObservation,
  personality: Personality,
  unseen: number[],
  beforeTurns: number,
  sampled?: number,
): number {
  const selected = new Set(play.cards.map((c) => c.id));
  const remaining = obs.hand.filter((c) => !selected.has(c.id));
  if (!remaining.length) return 1000;
  const cfg = style[personality];
  const turnGain = beforeTurns - estimatedTurns(remaining);
  let score =
    turnGain * 3.2 +
    play.cards.length * 0.38 -
    cardCost(play, obs.hand, personality);
  const controlChance =
    sampled === undefined
      ? control(play, unseen)
      : 0.8 * sampled + 0.2 * control(play, unseen);
  score += controlChance * cfg.control;
  const opposingCount =
    obs.landlord === obs.seat
      ? Math.min(...obs.counts.filter((_, i) => i !== obs.seat))
      : obs.counts[obs.landlord];
  const urgency = opposingCount <= 2 ? 4.5 : opposingCount <= 5 ? 2.2 : 0;
  if (obs.trick && obs.trick.seat !== obs.seat) score += cfg.contest + urgency;
  if (obs.trick && obs.trick.seat === obs.landlord && obs.seat !== obs.landlord)
    score += 0.7;
  if (obs.trick === null && play.main <= 10) score += 0.3;
  return score;
}

function finishInTwo(
  play: Play,
  candidates: Play[],
  handSize: number,
): boolean {
  const first = new Set(play.cards.map((c) => c.id));
  const remaining = handSize - first.size;
  if (remaining <= 0) return true;
  // Candidate order and this scan cap are shared by all personalities.
  let examined = 0;
  for (const next of candidates) {
    if (++examined > 240) break;
    if (
      next.cards.length === remaining &&
      next.cards.every((c) => !first.has(c.id))
    )
      return true;
  }
  return false;
}

export function chooseAction(
  obs: AiObservation,
  personality: Personality,
): { action: GameAction; explanation: string } {
  const cfg = style[personality];
  if (obs.phase === "bidding") {
    const score = strength(obs.hand, obs.wildRank);
    const threshold = obs.bidStage === "call" ? cfg.bid : cfg.rob;
    const yes = score >= threshold;
    return {
      action: { type: "bid", yes },
      explanation: yes
        ? obs.bidStage === "call"
          ? "手牌控制力较强，选择叫地主。"
          : "手牌有足够控制力，选择抢地主。"
        : "手牌控制力不足，暂不争地主。",
    };
  }
  if (obs.phase === "doubling") {
    const score = strength(obs.hand, obs.wildRank);
    const farmerAdjustment = obs.seat !== obs.landlord ? 1.1 : 0;
    const yes = score >= cfg.double + farmerAdjustment;
    return {
      action: { type: "double", yes },
      explanation: yes
        ? "手牌具备较强控制力，选择加倍。"
        : "保留稳健倍数，选择不加倍。",
    };
  }
  const previous =
    obs.trick && obs.trick.seat !== obs.seat ? obs.trick.play : null;
  const moves = legalMoves(obs.hand, obs.wildRank, previous);
  if (!moves.length) {
    if (previous)
      return {
        action: { type: "pass" },
        explanation: "没有能压过当前牌型的出法，选择不出。",
      };
    throw new Error("领出时没有合法出牌");
  }
  // Winning candidates can be sorted beyond the scoring cap, especially with wildcards.
  const winning = moves.find((move) => move.cards.length === obs.hand.length);
  if (winning)
    return {
      action: {
        type: "play",
        cardIds: winning.cards.map((c) => c.id),
        as: winning.as,
        kind: winning.kind,
        main: winning.main,
      },
      explanation: "这手牌可以直接出完，选择收尾。",
    };
  const unseen = unseenCounts(obs),
    beforeTurns = estimatedTurns(obs.hand);
  const samples = sampledResponses(obs);
  let best = moves[0],
    bestScore = -Infinity;
  // Evaluate at most 320 candidates; legalMoves orders low cost plays first.
  for (let i = 0; i < Math.min(moves.length, 320); i++) {
    const move = moves[i];
    let score = candidateScore(
      move,
      obs,
      personality,
      unseen,
      beforeTurns,
      sampledControl(move, samples, obs),
    );
    if (!previous && finishInTwo(move, moves, obs.hand.length)) score += 1.1;
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  if (previous) {
    const partnerLeading =
      obs.seat !== obs.landlord && obs.trick!.seat !== obs.landlord;
    const landlordNearOut = obs.landlord >= 0 && obs.counts[obs.landlord] <= 2;
    if (
      partnerLeading &&
      !landlordNearOut &&
      best.cards.length < obs.hand.length
    ) {
      return {
        action: { type: "pass" },
        explanation: "队友掌握牌权，选择让队友继续出牌。",
      };
    }
    const passThreshold = partnerLeading ? 1.7 : 0.0;
    if (bestScore < passThreshold)
      return {
        action: { type: "pass" },
        explanation: "这手牌代价较高，保留牌力等待下次机会。",
      };
  }
  const explanation =
    best.cards.length === obs.hand.length
      ? "这手牌可以直接出完，选择收尾。"
      : bombLevel(best)
        ? `用${playName(best)}争取牌权。`
        : previous
          ? `用${playName(best)}接牌，争取继续出牌。`
          : `先出${playName(best)}，整理剩余手牌。`;
  return {
    action: {
      type: "play",
      cardIds: best.cards.map((c) => c.id),
      as: best.as,
      kind: best.kind,
      main: best.main,
    },
    explanation,
  };
}
