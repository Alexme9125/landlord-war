export const MODES = ["standard", "wild", "heaven-earth"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_NAMES: Record<Mode, string> = {
  standard: "标准玩法",
  wild: "癞子玩法",
  "heaven-earth": "天地癞子",
};
/** A rank for the original four-wild mode, or both ranks for heaven/earth. */
export type Wildcards = number | null | readonly number[];
export const BASE_STAKES = [10, 20, 50] as const;
export type BaseStake = (typeof BASE_STAKES)[number];
export function parseBaseStake(value: unknown): BaseStake {
  if (!BASE_STAKES.includes(value as BaseStake))
    throw new Error("底注只能选择 10、20 或 50 Tokens");
  return value as BaseStake;
}
export interface ReliefChallenge {
  id: string;
  question: string;
}
export type Personality = "cautious" | "balanced" | "bold";
export type Suit = "S" | "H" | "C" | "D" | "J";
export interface Card {
  id: string;
  rank: number;
  suit: Suit;
}
export type PlayKind =
  | "single"
  | "pair"
  | "triple"
  | "tripleSingle"
  | "triplePair"
  | "straight"
  | "pairChain"
  | "airplane"
  | "airplaneSingle"
  | "airplanePair"
  | "fourSingle"
  | "fourPair"
  | "softBomb"
  | "bomb"
  | "wildBomb"
  | "mixedWildBomb"
  | "rocket";
export interface Play {
  cards: Card[];
  as: number[];
  kind: PlayKind;
  main: number;
  chain: number;
}
export interface MultiplierEvent {
  reason: string;
  factor: number;
  value: string;
}
export type GameAction =
  | { type: "bid"; yes: boolean }
  | { type: "double"; yes: boolean }
  | {
      type: "play";
      cardIds: string[];
      as?: number[];
      kind?: PlayKind;
      main?: number;
    }
  | { type: "pass" };
export interface GameEvent {
  index: number;
  seat: number;
  type: string;
  text: string;
  play?: Play;
  multiplier: string;
  explanation?: string;
}
export interface GameState {
  id: string;
  mode: Mode;
  baseStake: BaseStake;
  phase: "bidding" | "doubling" | "playing" | "finished" | "redeal";
  hands: Card[][];
  initialHands: Card[][];
  bottom: Card[];
  wildRank: number | null;
  heavenRank: number | null;
  landlord: number;
  turn: number;
  doubles: (1 | 2 | null)[];
  bidding: {
    stage: "call" | "rob";
    first: number;
    caller: number;
    candidate: number;
    passed: number[];
    pending: number[];
    called: number;
  };
  multiplier: string;
  multiplierEvents: MultiplierEvent[];
  trick: { seat: number; play: Play } | null;
  passes: number;
  playedCounts: number[];
  events: GameEvent[];
  winner: "landlord" | "farmers" | null;
}
export interface Account {
  id: string;
  name: string;
  balance: string;
  games: number;
  wins: number;
}
export interface PlayerView {
  id: string;
  name: string;
  balance: string;
  ready: boolean;
  connected: boolean;
  bot?: Personality;
  count: number;
  doubled: number | null;
}
export interface SettlementLine {
  id: string;
  name: string;
  before: string;
  delta: string;
  after: string;
}
export interface ResultView {
  winner: "landlord" | "farmers";
  reason: string;
  lines: SettlementLine[];
  replayId: string;
  multiplier: string;
  baseStake: BaseStake;
}
export interface RoomView {
  code: string;
  mode: Mode;
  kind: "pve" | "pvp";
  host: string;
  baseStake: BaseStake;
  version: number;
  seats: (PlayerView | null)[];
  spectators: { id: string; name: string }[];
  mySeat: number;
  game: null | {
    id: string;
    baseStake: BaseStake;
    phase: GameState["phase"];
    landlord: number;
    turn: number;
    bidStage: "call" | "rob";
    hand: Card[];
    bottom: Card[];
    wildRank: number | null;
    heavenRank: number | null;
    multiplier: string;
    multiplierEvents: MultiplierEvent[];
    trick: GameState["trick"];
    events: GameEvent[];
    doubles: (number | null)[];
    lastPlays: ({ play?: Play; text: string } | null)[];
  };
  deadline: number | null;
  pausedUntil: number | null;
  result: ResultView | null;
}
export type RoomCommand =
  | { type: "ready" }
  | { type: "stake"; baseStake: BaseStake }
  | { type: "sit"; seat: number }
  | { type: "stand" }
  | { type: "leave" }
  | { type: "game"; action: GameAction };
export const PERSONALITIES: Record<
  Personality,
  { name: string; description: string }
> = {
  cautious: { name: "谨慎", description: "留住控制，稳妥收尾" },
  balanced: { name: "平衡", description: "攻守有度，顺势而为" },
  bold: { name: "激进", description: "争取先手，主动进攻" },
};
