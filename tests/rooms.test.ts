import { describe, expect, it, vi } from "vitest";
import { Rooms } from "../server/rooms.ts";
import { Store } from "../server/store.ts";
import { chooseAction } from "../server/ai.ts";
import * as ai from "../server/ai.ts";
import type { Account, BotConfig, Mode, RoomCommand } from "../shared/types.ts";

function setup(mode: Mode = "standard") {
  const store = new Store(":memory:");
  const accounts = ["甲", "乙", "丙", "丁"].map(
    (name) => store.createAccount(name).account,
  );
  const updates: number[] = [];
  const rooms = new Rooms(store, (room) => updates.push(room.version), {
    bid: 15_000,
    play: 30_000,
    grace: 5_000,
    bot: 0,
  });
  accounts.forEach((account, index) =>
    rooms.connect(account.id, `socket-${index}`),
  );
  const room = rooms.create(accounts[0], mode, "pvp");
  accounts.slice(1).forEach((account) => rooms.join(account, room.code));
  let serial = 0;
  const send = (
    account: Account,
    command: RoomCommand,
    version = room.version,
    id = `command-${++serial}`,
  ) => rooms.command(account.id, version, id, command);
  const start = () => {
    accounts.slice(0, 3).forEach((account) => send(account, { type: "ready" }));
    expect(room.game?.phase).toBe("bidding");
  };
  const landlord = () => {
    const first = room.game!.turn;
    send(accounts[first], { type: "game", action: { type: "bid", yes: true } });
    while (room.game!.phase === "bidding") {
      send(accounts[room.game!.turn], {
        type: "game",
        action: { type: "bid", yes: false },
      });
    }
    expect(room.game?.phase).toBe("doubling");
    return room.game!.landlord;
  };
  return { store, accounts, rooms, room, updates, send, start, landlord };
}

describe("Rooms", () => {
  it("normalizes legacy bots and preserves configured names, personalities and difficulties", () => {
    const store = new Store(":memory:");
    const account = store.createAccount("房主").account;
    const rooms = new Rooms(store, () => {}, {
      bid: 15_000, play: 30_000, grace: 5_000, bot: 0,
    });
    rooms.connect(account.id, "owner");
    try {
      const legacy = rooms.create(account, "standard", "pve", ["balanced", "bold"]);
      expect(rooms.project(legacy, account.id).seats.slice(1)).toMatchObject([
        { name: "听澜", bot: "balanced", difficulty: "dazed" },
        { name: "见山", bot: "bold", difficulty: "dazed" },
      ]);
      rooms.leave(legacy, account.id);
      const bots: BotConfig[] = [
        { name: "  小云  ", difficulty: "gentle", personality: "cautious" },
        { name: "破浪", difficulty: "fierce", personality: "balanced" },
      ];
      const room = rooms.create(account, "standard", "pve", bots);
      expect(rooms.project(room, account.id).seats.slice(1)).toMatchObject([
        { name: "小云", bot: "cautious", difficulty: "gentle" },
        { name: "破浪", bot: "balanced", difficulty: "fierce" },
      ]);
      expect(bots[0].name).toBe("  小云  ");
      const spy = vi.spyOn(ai, "chooseAction");
      try {
        if (room.game!.turn === 0)
          rooms.command(account.id, room.version, "human-pass", {
            type: "game", action: { type: "bid", yes: false },
          });
        const bot = room.seats[room.game!.turn]!;
        rooms.tick();
        expect(spy).toHaveBeenCalledWith(
          expect.any(Object), bot.bot, bot.difficulty,
        );
      } finally {
        spy.mockRestore();
      }
      room.game!.phase = "finished";
      room.seats[0]!.ready = false;
      rooms.command(account.id, room.version, "next-round", { type: "ready" });
      expect(room.game!.phase).toBe("bidding");
      expect(rooms.project(room, account.id).seats.slice(1)).toMatchObject([
        { name: "小云", bot: "cautious", difficulty: "gentle" },
        { name: "破浪", bot: "balanced", difficulty: "fierce" },
      ]);
      for (let attempts = 0; room.game!.landlord < 0 && attempts < 15; attempts++) {
        if (room.game!.turn === 0)
          rooms.command(account.id, room.version, `bid-${attempts}`, {
            type: "game", action: { type: "bid", yes: true },
          });
        else rooms.tick();
      }
      expect(room.game!.landlord).toBeGreaterThanOrEqual(0);
      rooms.leave(room, account.id);
      expect(store.getReplay(room.result!.replayId, account.id)).toMatchObject({
        players: [
          expect.any(Object),
          { name: "小云", bot: "cautious", difficulty: "gentle" },
          { name: "破浪", bot: "balanced", difficulty: "fierce" },
        ],
      });
    } finally {
      store.close();
    }
  });

  it("rejects malformed bot configurations without creating a room", () => {
    const store = new Store(":memory:");
    const account = store.createAccount("房主").account;
    const rooms = new Rooms(store, () => {});
    try {
      const valid = { name: "听澜", difficulty: "gentle", personality: "bold" };
      for (const bots of [
        null, [], [valid], [valid, null], [valid, "bold"],
        [{ ...valid, name: "\u0000bad" }, valid],
        [{ ...valid, name: "太".repeat(17) }, valid],
        [{ ...valid, name: 2 }, valid],
        [{ ...valid, difficulty: "unknown" }, valid],
        [{ ...valid, personality: "unknown" }, valid],
        ["bold", "unknown"],
      ]) {
        expect(() => rooms.create(account, "standard", "pve", bots as BotConfig[])).toThrow();
        expect(rooms.rooms.size).toBe(0);
        expect(rooms.current(account.id)).toBeUndefined();
      }
    } finally {
      store.close();
    }
  });

  it("lets only the host change supported stakes before play and clears human readiness", () => {
    const { store, accounts, room, rooms, send, start } = setup();
    try {
      expect(room.baseStake).toBe(10);
      for (const account of [accounts[1], accounts[3]])
        expect(() => send(account, { type: "stake", baseStake: 50 })).toThrow(
          "只有房主",
        );
      for (const value of [0, 15, 20.5, "20", null, undefined])
        expect(() =>
          send(accounts[0], { type: "stake", baseStake: value } as RoomCommand),
        ).toThrow("底注只能选择");
      send(accounts[1], { type: "ready" });
      const stale = room.version;
      send(accounts[0], { type: "stake", baseStake: 50 });
      expect(room.seats.slice(0, 3).map((s) => s?.ready)).toEqual([
        false,
        false,
        false,
      ]);
      expect(() => send(accounts[2], { type: "ready" }, stale)).toThrow(
        "牌桌已更新",
      );
      for (const account of accounts)
        expect(rooms.project(room, account.id).baseStake).toBe(50);
      send(accounts[1], { type: "ready" });
      send(accounts[0], { type: "stake", baseStake: 50 });
      expect(room.seats[1]?.ready).toBe(true);
      send(accounts[1], { type: "ready" });
      start();
      expect(room.game).toMatchObject({ baseStake: 50, multiplier: "15" });
      expect(() => send(accounts[0], { type: "stake", baseStake: 20 })).toThrow(
        "对局中",
      );
      expect(room.baseStake).toBe(50);
    } finally {
      store.close();
    }
  });

  it.each(["standard", "wild", "heaven-earth"] as const)(
    "preserves %s stakes through redeal, settlement and replay while allowing the next round to change",
    (mode) => {
      const { store, accounts, room, rooms, send, start, landlord } =
        setup(mode);
      try {
        send(accounts[0], { type: "stake", baseStake: 50 });
        start();
        for (let i = 0; i < 3; i++)
          send(accounts[room.game!.turn], {
            type: "game",
            action: { type: "bid", yes: false },
          });
        expect(room.game).toMatchObject({
          mode,
          phase: "bidding",
          baseStake: 50,
          multiplier: "15",
        });
        if (mode === "heaven-earth") {
          expect(room.game!.heavenRank).toBeGreaterThanOrEqual(3);
          expect(room.game!.heavenRank).toBeLessThanOrEqual(15);
          expect(room.game!.wildRank).toBeGreaterThanOrEqual(3);
          expect(room.game!.wildRank).toBeLessThanOrEqual(15);
          expect(room.game!.heavenRank).not.toBe(room.game!.wildRank);
        }
        const landlordSeat = landlord();
        const gameId = room.game!.id;
        const ranks = {
          heavenRank: room.game!.heavenRank,
          wildRank: room.game!.wildRank,
        };
        const pairAmount = 50n * BigInt(room.game!.multiplier);
        send(accounts[1], { type: "leave" });
        expect(room.result?.baseStake).toBe(50);
        expect(room.result?.lines[landlordSeat].delta).toBe(
          String(pairAmount * (landlordSeat === 1 ? -2n : 2n)),
        );
        const result = structuredClone(room.result);
        send(accounts[0], { type: "stake", baseStake: 20 });
        expect(room.game?.baseStake).toBe(50);
        expect(room.result).toEqual(result);
        expect(store.getReplay(gameId, accounts[0].id)).toMatchObject({
          mode,
          game: { mode, baseStake: 50, ...ranks },
        });
        expect(rooms.spectatorReplay(accounts[3].id, gameId)).toMatchObject({
          mode,
          game: { mode, baseStake: 50, ...ranks },
        });
        expect(store.getHistory(accounts[0].id)[0]).toMatchObject({
          id: gameId,
          mode,
        });
        rooms.join(store.getAccount(accounts[1].id)!, room.code);
        start();
        expect(room.game).toMatchObject({
          mode,
          baseStake: 20,
          multiplier: "15",
        });
        if (mode === "heaven-earth")
          expect(room.game!.heavenRank).not.toBe(room.game!.wildRank);
        expect(room.result).toBeNull();
      } finally {
        store.close();
      }
    },
  );

  it("reveals the heaven wildcard while bidding and both wildcards after landlord selection to seats, spectators, and AI", () => {
    const { store, accounts, rooms, room, start, landlord } =
      setup("heaven-earth");
    try {
      start();
      const { heavenRank, wildRank } = room.game!;
      expect(heavenRank).not.toBe(wildRank);
      for (const account of accounts) {
        const view = rooms.project(room, account.id);
        expect(view.mode).toBe("heaven-earth");
        expect(view.game).toMatchObject({
          phase: "bidding",
          heavenRank,
          wildRank: null,
          bottom: [],
        });
        expect(view.game?.hand).toEqual(
          account.id === accounts[3].id
            ? []
            : room.game!.hands[accounts.findIndex((a) => a.id === account.id)],
        );
      }
      expect(rooms.observation(room, room.game!.turn)).toMatchObject({
        wildRank: heavenRank,
        bottom: [],
      });
      rooms.disconnect(accounts[0].id, "socket-0");
      rooms.connect(accounts[0].id, "reconnected-socket");
      expect(rooms.current(accounts[0].id)).toBe(room);
      expect(rooms.project(room, accounts[0].id).game).toMatchObject({
        heavenRank,
        wildRank: null,
        bottom: [],
      });

      landlord();
      for (const account of accounts)
        expect(rooms.project(room, account.id).game).toMatchObject({
          heavenRank,
          wildRank,
          bottom: room.game!.bottom,
        });
      expect(rooms.observation(room, room.game!.landlord)).toMatchObject({
        wildRank: [heavenRank, wildRank],
        bottom: room.game!.bottom,
      });
    } finally {
      store.close();
    }
  });

  it("applies the selected stake to immediate PVE and transfers control to the next host", () => {
    const { store, accounts, room, rooms, send } = setup();
    try {
      send(accounts[0], { type: "stake", baseStake: 20 });
      send(accounts[0], { type: "leave" });
      expect(room.host).toBe(accounts[1].id);
      send(accounts[1], { type: "stake", baseStake: 50 });
      const pve = rooms.create(
        accounts[0],
        "wild",
        "pve",
        ["balanced", "cautious"],
        20,
      );
      expect(pve.game).toMatchObject({ baseStake: 20, multiplier: "15" });
      expect(rooms.project(pve, accounts[0].id).game?.baseStake).toBe(20);
    } finally {
      store.close();
    }
  });

  it("renames seated players and spectators without changing identity or an active round", () => {
    const { store, accounts, rooms, room, start, updates } = setup();
    try {
      start();
      const game = structuredClone(room.game);
      const deadline = room.deadline;
      const version = room.version;
      const renamed = rooms.rename(accounts[0].id, "  Darwin玩家  ");
      expect(renamed).toEqual({ ...accounts[0], name: "Darwin玩家" });
      expect(room.seats[0]).toMatchObject({
        id: accounts[0].id,
        name: "Darwin玩家",
      });
      expect(room.members.get(accounts[0].id)).toBe("Darwin玩家");
      expect(room.host).toBe(accounts[0].id);
      expect(room.game).toEqual(game);
      expect(room.deadline).toBe(deadline);
      expect(room.version).toBe(version + 1);
      expect(updates.at(-1)).toBe(room.version);
      rooms.rename(accounts[3].id, "看牌的朋友");
      expect(rooms.project(room, accounts[1].id).spectators).toEqual([
        { id: accounts[3].id, name: "看牌的朋友" },
      ]);
      expect(rooms.project(room, accounts[3].id).mySeat).toBe(-1);
      const validVersion = room.version;
      expect(() => rooms.rename(accounts[0].id, "\u0000bad")).toThrow("昵称");
      expect(room.version).toBe(validVersion);
      expect(store.getAccount(accounts[0].id)?.name).toBe("Darwin玩家");
      expect(room.members.get(accounts[0].id)).toBe("Darwin玩家");
    } finally {
      store.close();
    }
  });

  it("keeps completed replay and result names immutable after later nickname changes", () => {
    const { store, accounts, rooms, room, start, landlord, send } = setup();
    try {
      start();
      landlord();
      send(accounts[2], { type: "leave" });
      const replayId = room.result!.replayId;
      const saved = structuredClone(store.getReplay(replayId, accounts[0].id));
      const spectatorReplay = structuredClone(
        rooms.spectatorReplay(accounts[3].id, replayId),
      );
      const result = structuredClone(room.result);
      rooms.rename(accounts[0].id, "新的名字");
      expect(room.seats[0]?.name).toBe("新的名字");
      expect(room.result).toEqual(result);
      expect(store.getReplay(replayId, accounts[0].id)).toEqual(saved);
      expect(rooms.spectatorReplay(accounts[3].id, replayId)).toEqual(
        spectatorReplay,
      );
    } finally {
      store.close();
    }
  });

  it("keeps the fourth member watching and enforces unique seats, standing, and sitting", () => {
    const { store, accounts, rooms, room, send } = setup();
    try {
      expect(room.seats.map((seat) => seat?.id)).toEqual(
        accounts.slice(0, 3).map((a) => a.id),
      );
      expect(rooms.project(room, accounts[3].id)).toMatchObject({
        mySeat: -1,
        spectators: [{ id: accounts[3].id, name: "丁" }],
      });
      expect(rooms.join(accounts[1], room.code)).toBe(room);
      expect(
        room.seats.filter((seat) => seat?.id === accounts[1].id),
      ).toHaveLength(1);
      expect(() => send(accounts[3], { type: "ready" })).toThrow("请先坐下");
      expect(() => send(accounts[3], { type: "sit", seat: 1 })).toThrow(
        "这个座位已有人",
      );
      send(accounts[1], { type: "stand" });
      expect(rooms.project(room, accounts[1].id).mySeat).toBe(-1);
      send(accounts[3], { type: "sit", seat: 1 });
      expect(rooms.project(room, accounts[3].id).mySeat).toBe(1);
      expect(() => send(accounts[3], { type: "sit", seat: 2 })).toThrow(
        "你已经坐下了",
      );
    } finally {
      store.close();
    }
  });

  it("projects only own hand and hides independent doubles and AI explanations", () => {
    const { store, accounts, rooms, room, send, start, landlord } = setup();
    try {
      start();
      const own = rooms.project(room, accounts[0].id);
      const spectator = rooms.project(room, accounts[3].id);
      expect(own.game?.hand).toEqual(room.game!.hands[0]);
      expect(spectator.game?.hand).toEqual([]);
      expect(spectator.game?.bottom).toEqual([]);
      const otherCard = room.game!.hands[1][0].id;
      expect(JSON.stringify(own)).not.toContain(`"id":"${otherCard}"`);
      landlord();
      send(accounts[0], {
        type: "game",
        action: { type: "double", yes: true },
      });
      const seenByZero = rooms.project(room, accounts[0].id);
      const seenByOne = rooms.project(room, accounts[1].id);
      expect(seenByZero.game?.doubles[0]).toBe(2);
      expect(seenByOne.game?.doubles[0]).toBeNull();
      expect(seenByOne.seats[0]?.doubled).toBeNull();
      room.game!.events.push({
        index: room.game!.events.length,
        seat: 0,
        type: "test",
        text: "公开事件",
        multiplier: room.game!.multiplier,
        explanation: "私有 AI 分析",
      });
      expect(JSON.stringify(rooms.project(room, accounts[1].id))).not.toContain(
        "私有 AI 分析",
      );
    } finally {
      store.close();
    }
  });

  it("makes command IDs idempotent and rejects stale versions", () => {
    const { store, accounts, room, send } = setup();
    try {
      const version = room.version;
      send(accounts[0], { type: "ready" }, version, "same-id");
      expect(room.seats[0]?.ready).toBe(true);
      const updated = room.version;
      send(accounts[0], { type: "ready" }, version, "same-id");
      expect(room.version).toBe(updated);
      expect(room.seats[0]?.ready).toBe(true);
      expect(() =>
        send(accounts[0], { type: "ready" }, version, "different-id"),
      ).toThrow("牌桌已更新");
    } finally {
      store.close();
    }
  });

  it("accepts independent secret doubles from the same snapshot", () => {
    const { store, accounts, room, send, start, landlord } = setup();
    try {
      start();
      landlord();
      const version = room.version;
      send(
        accounts[0],
        { type: "game", action: { type: "double", yes: true } },
        version,
      );
      send(
        accounts[1],
        { type: "game", action: { type: "double", yes: false } },
        version,
      );
      expect(room.game?.doubles.slice(0, 2)).toEqual([2, 1]);
      expect(room.game?.phase).toBe("doubling");
    } finally {
      store.close();
    }
  });

  it("uses the injected bid timeout for a connected idle player", () => {
    const { store, rooms, room, start } = setup();
    try {
      start();
      const first = room.game!.turn;
      rooms.tick(Date.now() + 15_001);
      expect(room.game!.events.at(-1)).toMatchObject({
        seat: first,
        type: "bid",
        text: "不叫",
      });
      expect(room.game!.turn).not.toBe(first);
    } finally {
      store.close();
    }
  });

  it("forfeits a leaving landlord and caps the loss at the real wallet", () => {
    const { store, accounts, room, send, start, landlord } = setup();
    try {
      start();
      const seat = landlord();
      room.game!.multiplier = "99999999999999999999";
      const gameId = room.game!.id;
      send(accounts[seat], { type: "leave" });
      expect(room.result?.winner).toBe("farmers");
      expect(room.result?.lines[seat].delta).toBe("-100000");
      expect(
        room.result?.lines.reduce((sum, line) => sum + BigInt(line.delta), 0n),
      ).toBe(0n);
      expect(store.getAccount(accounts[seat].id)?.balance).toBe("0");
      expect(store.getHistory(accounts[seat].id)[0].id).toBe(gameId);
    } finally {
      store.close();
    }
  });

  it("pauses on disconnect, resumes on reconnect, and forfeits on grace expiry", () => {
    const { store, accounts, rooms, room, start, landlord } = setup();
    try {
      start();
      const seat = landlord();
      const id = accounts[seat].id;
      const remaining = room.deadline! - Date.now();
      rooms.disconnect(id, `socket-${seat}`);
      expect(room.deadline).toBeNull();
      expect(room.disconnected.has(id)).toBe(true);
      rooms.tick(Date.now() + 1_000);
      expect(room.result).toBeNull();
      rooms.connect(id, `new-socket-${seat}`);
      expect(room.disconnected.has(id)).toBe(false);
      expect(room.deadline).not.toBeNull();
      expect(room.deadline! - Date.now()).toBeLessThanOrEqual(
        remaining + 1_000,
      );
      rooms.disconnect(id, `new-socket-${seat}`);
      rooms.tick(Date.now() + 5_001);
      expect(room.result?.winner).toBe("farmers");
      expect(rooms.current(id)).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("keeps play active when a spectator disconnects and expires only that spectator", () => {
    const { store, accounts, rooms, room, send, start } = setup();
    try {
      start();
      const deadline = room.deadline;
      const spectatorId = accounts[3].id;
      rooms.disconnect(spectatorId, "socket-3");
      expect(room.deadline).toBe(deadline);
      expect(rooms.project(room, accounts[0].id).pausedUntil).toBeNull();
      const turn = room.game!.turn;
      send(accounts[turn], {
        type: "game",
        action: { type: "bid", yes: true },
      });
      expect(room.game?.events.at(-1)).toMatchObject({
        seat: turn,
        type: "bid",
        text: "叫地主",
      });
      rooms.tick(Date.now() + 5_001);
      expect(rooms.current(spectatorId)).toBeUndefined();
      expect(room.members.has(spectatorId)).toBe(false);
      expect(room.seats.map((seat) => seat?.id)).toEqual(
        accounts.slice(0, 3).map((account) => account.id),
      );
      expect(room.game?.phase).toBe("bidding");
      expect(room.deadline).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it("keeps original player identities in a finished spectator replay after a player leaves", () => {
    const { store, accounts, rooms, room, send, start, landlord } = setup();
    try {
      start();
      const departingSeat = landlord();
      const departingId = accounts[departingSeat].id;
      const gameId = room.game!.id;
      send(accounts[departingSeat], { type: "leave" });
      const replay = rooms.spectatorReplay(accounts[3].id, gameId) as {
        players: ({ id: string } | null)[];
      } | null;
      expect(replay).not.toBeNull();
      expect(replay?.players[departingSeat]?.id).toBe(departingId);
    } finally {
      store.close();
    }
  });

  it.each(["standard", "wild", "heaven-earth"] as Mode[])(
    "finishes a %s game through room commands",
    (mode) => {
      const { store, accounts, rooms, room, send, start } = setup(mode);
      try {
        start();
        let steps = 0;
        while (!room.result && steps < 300) {
          const game = room.game!;
          const seat =
            game.phase === "doubling"
              ? game.doubles.findIndex((value) => value === null)
              : game.turn;
          const choice = chooseAction(
            rooms.observation(room, seat),
            "balanced",
          );
          send(accounts[seat], { type: "game", action: choice.action });
          steps++;
        }
        expect(room.result).not.toBeNull();
        expect(room.game?.phase).toBe("finished");
        expect(room.result?.lines).toHaveLength(3);
        expect(
          room.result?.lines.reduce(
            (sum, line) => sum + BigInt(line.delta),
            0n,
          ),
        ).toBe(0n);
        expect(
          store.getReplay(room.result!.replayId, accounts[0].id),
        ).not.toBeNull();
      } finally {
        store.close();
      }
    },
    30_000,
  );
});
