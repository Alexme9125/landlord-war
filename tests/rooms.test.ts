import { describe, expect, it } from "vitest";
import { Rooms } from "../server/rooms.ts";
import { Store } from "../server/store.ts";
import { chooseAction } from "../server/ai.ts";
import type { Account, Mode, RoomCommand } from "../shared/types.ts";

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

  it.each(["standard", "wild"] as Mode[])(
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
