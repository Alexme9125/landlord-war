import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction } from "../shared/engine.ts";
import { Rooms, type Room } from "../server/rooms.ts";
import { Store } from "../server/store.ts";
import type { Account, RoomCommand } from "../shared/types.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

function setup(kind: "pve" | "pvp", start = true) {
  const store = new Store(":memory:");
  const accounts = ["甲", "乙", "丙", "丁", "戊"].map(
    (name) => store.createAccount(name).account,
  );
  const updates: number[] = [];
  const rooms = new Rooms(store, (room) => updates.push(room.version), {
    bid: 15_000,
    play: 30_000,
    grace: 5_000,
    bot: 0,
  });
  for (let i = 0; i < accounts.length; i++)
    rooms.connect(accounts[i].id, `socket-${i}`);
  const room = rooms.create(accounts[0], "standard", kind);
  if (kind === "pvp") {
    for (const account of accounts.slice(1, 4)) rooms.join(account, room.code);
    if (start)
      for (const account of accounts.slice(0, 3))
        rooms.command(account.id, room.version, `ready-${account.id}`, {
          type: "ready",
        });
  }
  let serial = 0;
  const send = (
    account: Account,
    command: RoomCommand,
    version = room.version,
    id = `pause-test-${++serial}`,
  ) => rooms.command(account.id, version, id, command);
  return { store, accounts, rooms, room, updates, send };
}

function doubling(room: Room) {
  let game = room.game!;
  while (game.phase === "bidding")
    game = applyAction(game, game.turn, { type: "bid", yes: game.turn === 0 });
  expect(game.landlord).toBe(0);
  expect(game.phase).toBe("doubling");
  room.game = game;
  return game;
}

/** Reach a real engine playing state with the human host as landlord. */
function playing(room: Room) {
  let game = room.game!.phase === "bidding" ? doubling(room) : room.game!;
  for (let seat = 0; seat < 3; seat++)
    game = applyAction(game, seat, { type: "double", yes: false });
  expect(game.phase).toBe("playing");
  room.game = game;
  room.remaining = 30_000;
  room.deadline = Date.now() + 30_000;
  room.botAt = Date.now();
  return game;
}

describe("manual turn pause", () => {
  it("freezes exact remaining time, rejects game and hint, and resumes once with command deduplication", () => {
    const { store, accounts, rooms, room, send, updates } = setup("pvp");
    try {
      playing(room);
      vi.setSystemTime(Date.now() + 7_345);
      const oldDeadline = room.deadline!;
      const oldVersion = room.version;
      send(accounts[0], { type: "pause" }, oldVersion, "pause-once");
      expect(room.pausedBy).toBe(accounts[0].id);
      expect(room.deadline).toBeNull();
      expect(room.remaining).toBe(22_655);
      expect(room.remaining).toBe(oldDeadline - Date.now());
      expect(updates.at(-1)).toBe(room.version);
      for (const account of accounts.slice(0, 4))
        expect(rooms.project(room, account.id).pause).toEqual({
          by: accounts[0].id,
          remainingMs: 22_655,
        });
      expect(() =>
        send(accounts[0], { type: "game", action: { type: "pass" } }),
      ).toThrow();
      expect(() => rooms.hint(accounts[0].id)).toThrow();
      const frozen = structuredClone(room.game);
      vi.setSystemTime(Date.now() + 120_000);
      rooms.tick();
      expect(room.game).toEqual(frozen);
      expect(room.remaining).toBe(22_655);
      expect(room.deadline).toBeNull();
      const unchangedVersion = room.version;
      send(accounts[0], { type: "pause" }, oldVersion, "pause-once");
      expect(room.version).toBe(unchangedVersion);
      expect(() =>
        send(accounts[0], { type: "pause" }, oldVersion, "pause-again"),
      ).toThrow("牌桌已更新");
      expect(() => send(accounts[0], { type: "pause" })).toThrow();

      rooms.rename(accounts[0].id, "新房主");
      rooms.join(accounts[4], room.code);
      expect(rooms.project(room, accounts[4].id).pause).toEqual({
        by: accounts[0].id,
        remainingMs: 22_655,
      });
      expect(room.pausedBy).toBe(accounts[0].id);
      const pausedVersion = room.version;
      send(accounts[0], { type: "resume" }, pausedVersion, "resume-once");
      expect(room.pausedBy).toBeNull();
      expect(room.deadline).toBe(Date.now() + 22_655);
      const resumedDeadline = room.deadline;
      const resumedVersion = room.version;
      vi.setSystemTime(Date.now() + 4_000);
      send(accounts[0], { type: "resume" }, pausedVersion, "resume-once");
      expect(room.version).toBe(resumedVersion);
      expect(room.deadline).toBe(resumedDeadline);
      expect(() =>
        send(accounts[0], { type: "resume" }, pausedVersion, "resume-again"),
      ).toThrow("牌桌已更新");
      const events = room.game!.events.length;
      rooms.tick(resumedDeadline! - 1);
      expect(room.game!.events).toHaveLength(events);
      rooms.tick(resumedDeadline!);
      expect(room.game!.events.length).toBeGreaterThan(events);
      expect(room.game!.events.at(-1)?.explanation).toContain("超时");
    } finally {
      store.close();
    }
  });

  it("allows only the current connected human in the playing phase to pause and only that human to resume", () => {
    const { store, accounts, rooms, room, send } = setup("pvp", false);
    try {
      expect(() => send(accounts[0], { type: "pause" })).toThrow();
      expect(() => send(accounts[3], { type: "pause" })).toThrow();
      for (const account of accounts.slice(0, 3))
        send(account, { type: "ready" });
      expect(room.game!.phase).toBe("bidding");
      expect(() =>
        send(accounts[room.game!.turn], { type: "pause" }),
      ).toThrow();
      doubling(room);
      expect(() => send(accounts[0], { type: "pause" })).toThrow();
      playing(room);
      for (const account of accounts.slice(1, 4))
        expect(() => send(account, { type: "pause" })).toThrow();
      expect(() => send(accounts[3], { type: "resume" })).toThrow();
      expect(() => send(accounts[1], { type: "resume" })).toThrow();
      rooms.disconnect(accounts[1].id, "socket-1");
      expect(() => send(accounts[0], { type: "pause" })).toThrow();
      rooms.connect(accounts[1].id, "return-1");
      vi.setSystemTime(room.deadline! + 1);
      expect(() => send(accounts[0], { type: "pause" })).toThrow();
      expect(room.pausedBy).toBeNull();
      vi.setSystemTime(1_000_000);
      room.deadline = Date.now() + 30_000;
      send(accounts[0], { type: "pause" });
      for (const account of accounts.slice(1, 4))
        expect(() => send(account, { type: "resume" })).toThrow();
      expect(room.pausedBy).toBe(accounts[0].id);
      send(accounts[0], { type: "resume" });
      expect(room.pausedBy).toBeNull();
      room.game!.phase = "finished";
      expect(() => send(accounts[0], { type: "pause" })).toThrow();
    } finally {
      store.close();
    }
  });

  it("keeps a PVE human turn frozen across elapsed time and same-account tabs", () => {
    const { store, accounts, rooms, room, send } = setup("pve");
    try {
      playing(room);
      rooms.connect(accounts[0].id, "second-tab");
      vi.setSystemTime(Date.now() + 5_123);
      send(accounts[0], { type: "pause" });
      expect(room.remaining).toBe(24_877);
      const frozen = structuredClone(room.game);
      rooms.disconnect(accounts[0].id, "socket-0");
      expect(room.disconnected.has(accounts[0].id)).toBe(false);
      expect(room.pausedBy).toBe(accounts[0].id);
      rooms.disconnect(accounts[0].id, "second-tab");
      expect(room.disconnected.has(accounts[0].id)).toBe(true);
      vi.setSystemTime(Date.now() + 4_000);
      rooms.tick();
      expect(room.game).toEqual(frozen);
      expect(room.remaining).toBe(24_877);
      rooms.connect(accounts[0].id, "refreshed-tab");
      expect(room.disconnected.has(accounts[0].id)).toBe(false);
      expect(room.pausedBy).toBe(accounts[0].id);
      expect(room.deadline).toBeNull();
      send(accounts[0], { type: "resume" });
      expect(room.deadline).toBe(Date.now() + 24_877);
      const card = room.game!.hands[0][0];
      send(accounts[0], {
        type: "game",
        action: {
          type: "play",
          cardIds: [card.id],
          as: [card.rank],
          kind: "single",
          main: card.rank,
        },
      });
      expect(room.game!.turn).toBe(1);
      expect(() => send(accounts[0], { type: "pause" })).toThrow();
    } finally {
      store.close();
    }
  });

  it("keeps manual pause through two seated disconnections and blocks resume until both return", () => {
    const { store, accounts, rooms, room, send } = setup("pvp");
    try {
      playing(room);
      vi.setSystemTime(Date.now() + 9_001);
      send(accounts[0], { type: "pause" });
      expect(room.remaining).toBe(20_999);
      rooms.disconnect(accounts[1].id, "socket-1");
      vi.setSystemTime(Date.now() + 600);
      rooms.disconnect(accounts[2].id, "socket-2");
      expect(room.remaining).toBe(20_999);
      rooms.connect(accounts[1].id, "return-1");
      expect(() => send(accounts[0], { type: "resume" })).toThrow();
      expect(room.pausedBy).toBe(accounts[0].id);
      expect(room.deadline).toBeNull();
      vi.setSystemTime(Date.now() + 1_000);
      rooms.connect(accounts[2].id, "return-2");
      expect(room.remaining).toBe(20_999);
      send(accounts[0], { type: "resume" });
      expect(room.deadline).toBe(Date.now() + 20_999);
    } finally {
      store.close();
    }
  });

  it("clears manual pause on grace expiry, settles once, and starts a new unpaused round", () => {
    const { store, accounts, rooms, room, send } = setup("pvp");
    try {
      playing(room);
      send(accounts[0], { type: "pause" });
      const previousGameId = room.game!.id;
      rooms.disconnect(accounts[1].id, "socket-1");
      const graceEnds = room.disconnected.get(accounts[1].id)!;
      rooms.tick(graceEnds - 1);
      expect(room.game!.phase).toBe("playing");
      expect(room.pausedBy).toBe(accounts[0].id);
      rooms.tick(graceEnds);
      expect(room.game!.phase).toBe("finished");
      expect(room.pausedBy).toBeNull();
      expect(room.result?.replayId).toBe(previousGameId);
      expect(
        room.result?.lines.reduce(
          (total, line) => total + BigInt(line.delta),
          0n,
        ),
      ).toBe(0n);
      const result = structuredClone(room.result);
      rooms.tick(graceEnds + 10_000);
      expect(room.result).toEqual(result);
      expect(rooms.current(accounts[1].id)).toBeUndefined();
      send(accounts[3], { type: "sit", seat: 1 });
      for (const account of [accounts[0], accounts[3], accounts[2]])
        send(account, { type: "ready" });
      expect(room.game!.phase).toBe("bidding");
      expect(room.game!.id).not.toBe(previousGameId);
      expect(room.pausedBy).toBeNull();
      expect(rooms.project(room, accounts[0].id).pause).toBeNull();
    } finally {
      store.close();
    }
  });

  it("clears manual pause when its owner actively leaves", () => {
    const { store, accounts, room, send } = setup("pvp");
    try {
      playing(room);
      send(accounts[0], { type: "pause" });
      send(accounts[0], { type: "leave" });
      expect(room.game!.phase).toBe("finished");
      expect(room.pausedBy).toBeNull();
      expect(
        room.result?.lines.reduce(
          (total, line) => total + BigInt(line.delta),
          0n,
        ),
      ).toBe(0n);
    } finally {
      store.close();
    }
  });
});
