import { randomInt, randomUUID } from "node:crypto";
import { deck, gameWildRanks } from "../shared/cards.ts";
import { createGame, applyAction, forfeit } from "../shared/engine.ts";
import { playName } from "../shared/rules.ts";
import {
  DEFAULT_BOTS,
  parseBaseStake,
  type BaseStake,
} from "../shared/types.ts";
import type {
  Account,
  BotConfig,
  Difficulty,
  GameAction,
  GameState,
  Mode,
  Personality,
  Play,
  ResultView,
  RoomCommand,
  RoomView,
} from "../shared/types.ts";
import { Store, validName } from "./store.ts";
import { chooseAction, type AiObservation } from "./ai.ts";

type Seat = {
  id: string;
  name: string;
  ready: boolean;
  bot?: Personality;
  difficulty?: Difficulty;
  balance: string;
};
export interface Room {
  code: string;
  mode: Mode;
  kind: "pve" | "pvp";
  host: string;
  baseStake: BaseStake;
  version: number;
  seats: (Seat | null)[];
  members: Map<string, string>;
  game: GameState | null;
  result: ResultView | null;
  deadline: number | null;
  remaining: number;
  pausedBy: string | null;
  disconnected: Map<string, number>;
  botAt: number;
  updated: number;
  commands: Map<string, Set<string>>;
  completedReplay: unknown | null;
}
const active = (r: Room) =>
  !!r.game && !["finished", "redeal"].includes(r.game.phase);
const waitingForReconnect = (r: Room) =>
  r.seats.some((s) => s && !s.bot && r.disconnected.has(s.id));
const paused = (r: Room) => !!r.pausedBy || waitingForReconnect(r);
function shuffled() {
  const cards = deck();
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
const personalities: readonly Personality[] = ["cautious", "balanced", "bold"];
const difficulties: readonly Difficulty[] = ["dazed", "gentle", "fierce"];
function normalizeBots(input: unknown): BotConfig[] {
  if (!Array.isArray(input) || input.length !== 2)
    throw new Error("请配置两名机器人");
  if (input.every((value) => typeof value === "string")) {
    if (input.some((value) => !personalities.includes(value as Personality)))
      throw new Error("人格无效");
    return input.map((personality, index) => ({
      name: DEFAULT_BOTS[index].name,
      difficulty: "dazed",
      personality: personality as Personality,
    }));
  }
  return input.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("机器人配置无效");
    const { name, difficulty, personality } = value as Record<string, unknown>;
    if (typeof name !== "string")
      throw new Error("昵称须为1到16个字符，且不能包含控制字符");
    const selectedName = validName(name);
    if (!difficulties.includes(difficulty as Difficulty))
      throw new Error("机器人难度无效");
    if (!personalities.includes(personality as Personality))
      throw new Error("人格无效");
    return {
      name: selectedName,
      difficulty: difficulty as Difficulty,
      personality: personality as Personality,
    };
  });
}
function newGame(room: Room, id: string, first: number) {
  const wildRank = room.mode === "standard" ? null : randomInt(3, 16);
  const alternatives = Array.from({ length: 13 }, (_, i) => i + 3).filter(
    (rank) => rank !== wildRank,
  );
  const heavenRank =
    room.mode === "heaven-earth"
      ? alternatives[randomInt(alternatives.length)]
      : null;
  return createGame(
    id,
    room.mode,
    shuffled(),
    first,
    wildRank,
    room.baseStake,
    heavenRank,
  );
}

export class Rooms {
  readonly rooms = new Map<string, Room>();
  readonly membership = new Map<string, string>();
  readonly connections = new Map<string, Set<string>>();
  constructor(
    readonly store: Store,
    readonly notify: (r: Room) => void,
    readonly timing = { bid: 15000, play: 30000, grace: 60000, bot: 900 },
  ) {}
  current(id: string) {
    return this.rooms.get(this.membership.get(id) ?? "");
  }
  rename(id: string, name: string) {
    const account = this.store.rename(id, name);
    const room = this.current(id);
    if (room) {
      room.members.set(id, account.name);
      const seat = room.seats.find((player) => player?.id === id);
      if (seat) seat.name = account.name;
      this.changed(room);
    }
    return account;
  }
  connected(id: string) {
    return !!this.connections.get(id)?.size;
  }
  connect(id: string, socket: string) {
    const sockets = this.connections.get(id) ?? new Set();
    sockets.add(socket);
    this.connections.set(id, sockets);
    const room = this.current(id);
    if (room) {
      room.disconnected.delete(id);
      if (!paused(room) && active(room) && !room.deadline)
        room.deadline = Date.now() + room.remaining;
      this.changed(room);
    }
  }
  disconnect(id: string, socket: string) {
    const sockets = this.connections.get(id);
    sockets?.delete(socket);
    if (sockets?.size) return;
    this.connections.delete(id);
    const room = this.current(id);
    if (!room) return;
    if (active(room) && room.seats.some((s) => s?.id === id)) {
      if (!paused(room))
        room.remaining = Math.max(
          1000,
          (room.deadline ?? Date.now()) - Date.now(),
        );
      room.disconnected.set(id, Date.now() + this.timing.grace);
      room.deadline = null;
    } else room.disconnected.set(id, Date.now() + this.timing.grace);
    this.changed(room);
  }
  create(
    account: Account,
    mode: Mode,
    kind: "pve" | "pvp",
    bots: Personality[] | BotConfig[] = ["cautious", "bold"],
    baseStake: BaseStake = 10,
  ) {
    baseStake = parseBaseStake(baseStake);
    const selectedBots = normalizeBots(bots);
    if (this.current(account.id)) throw new Error("请先离开当前房间");
    if (BigInt(account.balance) === 0n)
      throw new Error("Tokens 已用完，请先领取救济");
    if (this.rooms.size >= 500) throw new Error("房间已满，请稍后再试");
    let code: string;
    do {
      code = String(randomInt(100000, 1000000));
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      mode,
      kind,
      host: account.id,
      baseStake,
      version: 0,
      seats: [{ ...account, ready: kind === "pve" }, null, null],
      members: new Map([[account.id, account.name]]),
      game: null,
      result: null,
      deadline: null,
      remaining: 0,
      pausedBy: null,
      disconnected: new Map(),
      botAt: 0,
      updated: Date.now(),
      commands: new Map(),
      completedReplay: null,
    };
    if (kind === "pve")
      for (let i = 1; i < 3; i++)
        room.seats[i] = {
          id: `bot-${randomUUID()}`,
          name: selectedBots[i - 1].name,
          ready: true,
          bot: selectedBots[i - 1].personality,
          difficulty: selectedBots[i - 1].difficulty,
          balance: "100000",
        };
    this.rooms.set(code, room);
    this.membership.set(account.id, code);
    if (kind === "pve") this.start(room);
    else this.changed(room);
    return room;
  }
  join(account: Account, code: string) {
    const current = this.current(account.id);
    if (current) {
      if (current.code === code) return current;
      throw new Error("请先离开当前房间");
    }
    const room = this.rooms.get(code);
    if (!room || room.kind === "pve")
      throw new Error("没有找到这个房间，请检查房间码");
    if (room.members.size >= 33) throw new Error("房间观众已满");
    room.members.set(account.id, account.name);
    this.membership.set(account.id, code);
    const empty = room.seats.findIndex((s) => !s);
    if (empty >= 0 && !active(room) && BigInt(account.balance) > 0n)
      room.seats[empty] = { ...account, ready: false };
    this.changed(room);
    return room;
  }
  private changed(room: Room) {
    room.version++;
    room.updated = Date.now();
    this.notify(room);
  }
  private resetTimer(room: Room) {
    room.remaining =
      room.game?.phase === "playing" ? this.timing.play : this.timing.bid;
    room.deadline =
      active(room) && !paused(room) ? Date.now() + room.remaining : null;
    room.botAt = Date.now() + this.timing.bot;
  }
  private start(room: Room) {
    if (!room.seats.every(Boolean)) throw new Error("还需要三名玩家");
    for (const s of room.seats)
      if (s && !s.bot) {
        const fresh = this.store.getAccount(s.id)!;
        if (BigInt(fresh.balance) === 0n)
          throw new Error(`${s.name} 需要先领取救济`);
        if (!this.connected(s.id)) throw new Error("有玩家尚未连接");
        s.balance = fresh.balance;
        s.name = fresh.name;
      }
    room.seats.forEach((s) => {
      if (s?.bot) s.balance = "100000";
    });
    room.result = null;
    room.completedReplay = null;
    room.pausedBy = null;
    room.game = newGame(room, randomUUID(), randomInt(3));
    room.disconnected.clear();
    this.resetTimer(room);
    this.changed(room);
  }
  command(
    id: string,
    version: number,
    commandId: string,
    command: RoomCommand,
  ) {
    const room = this.current(id);
    if (!room) throw new Error("你不在房间中");
    const seen = room.commands.get(id) ?? new Set<string>();
    if (seen.has(commandId)) return;
    // Independent secret double decisions can arrive against the same snapshot.
    const concurrentDouble =
      command.type === "game" &&
      command.action?.type === "double" &&
      room.game?.phase === "doubling";
    if (
      version !== room.version &&
      !concurrentDouble &&
      command.type !== "leave"
    )
      throw new Error("牌桌已更新，请重试");
    const seat = room.seats.findIndex((s) => s?.id === id);
    if (command.type === "leave") {
      this.leave(room, id);
      return;
    }
    if (command.type === "pause") {
      if (!room.game || room.game.phase !== "playing")
        throw new Error("出牌阶段才能暂停");
      if (seat < 0 || room.seats[seat]?.bot || seat !== room.game.turn)
        throw new Error("轮到你出牌时才能暂停");
      if (paused(room)) throw new Error("牌局已暂停");
      const remaining = (room.deadline ?? 0) - Date.now();
      if (remaining <= 0) throw new Error("本回合已超时，无法暂停");
      room.remaining = remaining;
      room.pausedBy = id;
      room.deadline = null;
      this.changed(room);
    } else if (command.type === "resume") {
      if (!room.pausedBy) throw new Error("当前没有手动暂停");
      if (room.pausedBy !== id) throw new Error("请等待暂停的玩家回来继续");
      if (waitingForReconnect(room)) throw new Error("请等待在座玩家重新连接");
      room.pausedBy = null;
      room.deadline = Date.now() + room.remaining;
      this.changed(room);
    } else if (command.type === "game") {
      if (seat < 0) throw new Error("观战时不能操作手牌");
      if (room.pausedBy) throw new Error("牌局已暂停，请先继续对局");
      if (waitingForReconnect(room)) throw new Error("等待断线玩家重连");
      this.act(room, seat, command.action);
    } else {
      if (active(room)) throw new Error("对局中不能调整房间");
      if (command.type === "stake") {
        if (room.host !== id) throw new Error("只有房主可以修改底注");
        const baseStake = parseBaseStake(command.baseStake);
        if (room.baseStake !== baseStake) {
          room.baseStake = baseStake;
          // A new stake needs fresh consent from every seated human player.
          room.seats.forEach((s) => {
            if (s && !s.bot) s.ready = false;
          });
        }
      } else if (command.type === "stand") {
        if (room.kind === "pve") throw new Error("练习模式请使用离开");
        if (seat >= 0) room.seats[seat] = null;
      } else if (command.type === "sit") {
        if (seat >= 0) throw new Error("你已经坐下了");
        if (
          !Number.isInteger(command.seat) ||
          command.seat < 0 ||
          command.seat > 2 ||
          room.seats[command.seat]
        )
          throw new Error("这个座位已有人");
        const account = this.store.getAccount(id)!;
        if (BigInt(account.balance) === 0n) throw new Error("请先领取救济");
        room.seats[command.seat] = { ...account, ready: false };
      } else if (command.type === "ready") {
        if (seat < 0) throw new Error("请先坐下");
        if (BigInt(this.store.getAccount(id)!.balance) === 0n)
          throw new Error("请先领取救济");
        room.seats[seat]!.ready = !room.seats[seat]!.ready;
        if (room.seats.every((s) => s?.ready)) this.start(room);
      } else throw new Error("未知操作");
      this.changed(room);
    }
    seen.add(commandId);
    if (seen.size > 256) seen.delete(seen.values().next().value!);
    room.commands.set(id, seen);
  }
  private act(
    room: Room,
    seat: number,
    action: GameAction,
    explanation?: string,
  ) {
    if (!room.game) throw new Error("还未开局");
    const before = room.game,
      next = applyAction(before, seat, action);
    const emitted = next.events
      .slice(before.events.length)
      .find((e) => e.seat === seat && e.type === action.type);
    if (
      emitted &&
      !explanation &&
      !room.seats[seat]?.bot &&
      before.phase === "playing"
    ) {
      const suggestion = chooseAction(this.observation(room, seat), "balanced");
      const chosen = emitted.play
        ? `你打出${playName(emitted.play)}，剩余 ${next.hands[seat].length} 张。`
        : "你选择保留手牌。";
      explanation = `${chosen} 平衡策略参考：${suggestion.explanation}`;
    }
    room.game = next;
    if (explanation && emitted) emitted.explanation = explanation;
    if (next.phase === "redeal") {
      room.game = newGame(room, next.id, (next.bidding.first + 1) % 3);
    }
    if (next.phase === "finished") {
      try {
        this.finish(room, "正常结束");
      } catch (error) {
        room.game = before;
        throw error;
      }
    } else if (next.phase !== before.phase || next.turn !== before.turn)
      this.resetTimer(room);
    this.changed(room);
  }
  private finish(room: Room, reason: string) {
    const game = room.game!;
    if (game.winner) {
      const players = room.seats.map((s) => ({ ...s!, bot: !!s!.bot }));
      const replay = {
        game,
        players: room.seats,
        mode: room.mode,
        kind: room.kind,
        at: Date.now(),
        reason,
      };
      const lines = this.store.settle({
        id: game.id,
        mode: room.mode,
        kind: room.kind,
        landlord: game.landlord,
        winner: game.winner,
        multiplier: game.multiplier,
        baseStake: game.baseStake,
        doubles: game.doubles.map((v) => v ?? 1),
        players,
        reason,
        replay,
      });
      room.completedReplay = structuredClone(replay);
      room.result = {
        winner: game.winner,
        reason,
        lines,
        replayId: game.id,
        multiplier: game.multiplier,
        baseStake: game.baseStake,
      };
      room.seats.forEach((s, i) => {
        if (s) s.balance = lines[i].after;
      });
    }
    room.deadline = null;
    room.pausedBy = null;
    room.seats.forEach((s) => {
      if (s) s.ready = !!s.bot;
    });
  }
  leave(room: Room, id: string) {
    const seat = room.seats.findIndex((s) => s?.id === id);
    if (seat >= 0 && active(room)) {
      const before = room.game!;
      room.game = forfeit(before, seat);
      try {
        this.finish(room, `${room.seats[seat]!.name} 离开对局`);
      } catch (error) {
        room.game = before;
        throw error;
      }
    }
    if (seat >= 0) room.seats[seat] = null;
    room.members.delete(id);
    room.disconnected.delete(id);
    room.commands.delete(id);
    this.membership.delete(id);
    if (room.host === id) room.host = room.members.keys().next().value ?? "";
    if (!room.members.size) {
      this.rooms.delete(room.code);
      return;
    }
    this.changed(room);
  }
  observation(room: Room, seat: number): AiObservation {
    const g = room.game!;
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
  hint(id: string) {
    const room = this.current(id);
    if (!room?.game || room.game.phase !== "playing")
      throw new Error("出牌阶段可使用提示");
    const seat = room.seats.findIndex((s) => s?.id === id);
    if (seat < 0 || seat !== room.game.turn)
      throw new Error("轮到你时可以使用提示");
    if (paused(room)) throw new Error("牌局已暂停，继续后可使用提示");
    return chooseAction(this.observation(room, seat), "balanced");
  }
  tick(now = Date.now()) {
    for (const room of this.rooms.values()) {
      try {
        const seatedDisconnected = [...room.disconnected].filter(([id]) =>
          room.seats.some((s) => s?.id === id),
        );
        const expired = [...room.disconnected].find(([, time]) => time <= now);
        if (expired) {
          this.leave(room, expired[0]);
          continue;
        }
        if (room.pausedBy || seatedDisconnected.length || !active(room))
          continue;
        const g = room.game!;
        if (g.phase === "doubling") {
          if (now >= room.botAt)
            for (let i = 0; i < 3; i++)
              if (room.seats[i]?.bot && g.doubles[i] === null) {
                const decision = chooseAction(
                  this.observation(room, i),
                  room.seats[i]!.bot!,
                  room.seats[i]!.difficulty ?? "dazed",
                );
                this.act(room, i, decision.action, decision.explanation);
              }
          if (
            room.game!.phase === "doubling" &&
            room.deadline &&
            now >= room.deadline
          )
            for (let i = 0; i < 3; i++)
              if (room.game!.doubles[i] === null)
                this.act(room, i, { type: "double", yes: false });
        } else if (room.seats[g.turn]?.bot && now >= room.botAt) {
          const decision = chooseAction(
            this.observation(room, g.turn),
            room.seats[g.turn]!.bot!,
            room.seats[g.turn]!.difficulty ?? "dazed",
          );
          this.act(room, g.turn, decision.action, decision.explanation);
        } else if (room.deadline && now >= room.deadline) {
          const action: GameAction =
            g.phase === "bidding"
              ? { type: "bid", yes: false }
              : g.trick
                ? { type: "pass" }
                : {
                    type: "play",
                    cardIds: [...g.hands[g.turn]]
                      .sort((a, b) => a.rank - b.rank)
                      .slice(0, 1)
                      .map((c) => c.id),
                  };
          this.act(room, g.turn, action, "操作超时，执行默认操作");
        }
      } catch (error) {
        console.error("room tick failed", room.code, error);
        room.botAt = now + 2000;
      }
    }
  }
  project(room: Room, id: string): RoomView {
    const g = room.game,
      mySeat = room.seats.findIndex((s) => s?.id === id);
    const hiddenDouble = g?.phase === "doubling";
    const lastPlays: ({ play?: Play; text: string } | null)[] = [
      null,
      null,
      null,
    ];
    for (const e of g?.events ?? [])
      if (e.type === "play" || e.type === "pass")
        lastPlays[e.seat] = { play: e.play, text: e.text };
    const paused = [...room.disconnected]
      .filter(([pid]) => room.seats.some((s) => s?.id === pid))
      .map(([, time]) => time);
    return {
      code: room.code,
      mode: room.mode,
      kind: room.kind,
      host: room.host,
      baseStake: room.baseStake,
      version: room.version,
      seats: room.seats.map((s, i) =>
        s
          ? {
              id: s.id,
              name: s.name,
              balance: s.bot ? s.balance : this.store.getAccount(s.id)!.balance,
              ready: s.ready,
              connected: !!s.bot || this.connected(s.id),
              bot: s.bot,
              difficulty: s.difficulty,
              count: g?.hands[i].length ?? 0,
              doubled:
                hiddenDouble && i !== mySeat ? null : (g?.doubles[i] ?? null),
            }
          : null,
      ),
      spectators: [...room.members]
        .filter(([pid]) => !room.seats.some((s) => s?.id === pid))
        .map(([id, name]) => ({ id, name })),
      mySeat,
      game: g
        ? {
            id: g.id,
            baseStake: g.baseStake,
            phase: g.phase,
            landlord: g.landlord,
            turn: g.turn,
            bidStage: g.bidding.stage,
            hand: mySeat >= 0 ? g.hands[mySeat] : [],
            bottom: g.landlord < 0 ? [] : g.bottom,
            wildRank: g.landlord < 0 ? null : g.wildRank,
            heavenRank: g.heavenRank,
            multiplier: g.multiplier,
            multiplierEvents: g.multiplierEvents,
            trick: g.trick,
            events: g.events.map(({ explanation, ...e }) => e),
            doubles: g.doubles.map((v, i) =>
              hiddenDouble && i !== mySeat ? null : v,
            ),
            lastPlays,
          }
        : null,
      deadline: room.deadline,
      pausedUntil: paused.length ? Math.min(...paused) : null,
      pause: room.pausedBy
        ? { by: room.pausedBy, remainingMs: room.remaining }
        : null,
      result: room.result,
    };
  }
  spectatorReplay(id: string, replayId: string) {
    const room = this.current(id);
    return room?.game?.phase === "finished" && room.game.id === replayId
      ? room.completedReplay
      : null;
  }
}
