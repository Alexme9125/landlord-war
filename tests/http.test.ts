import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { io as socketClient, type Socket } from "socket.io-client";
import { createApplication } from "../server/app.ts";
import type { Account, RoomView } from "../shared/types.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "landlord-http-"));
  const app = createApplication({ database: join(dir, "game.sqlite") });
  await new Promise<void>((resolve) =>
    app.http.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(app.http.address() as AddressInfo).port}`;
  cleanup.push(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const request = (path: string, options: RequestInit = {}) =>
    fetch(base + path, {
      ...options,
      headers: { Origin: base, ...options.headers },
    });
  const session = async () => {
    const response = await request("/api/session", { method: "POST" });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    return {
      cookie,
      account: (await response.json()).account as {
        id: string;
        balance: string;
      },
    };
  };
  const socket = (cookie: string, origin = base) =>
    socketClient(base, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 2_000,
      extraHeaders: { Cookie: cookie, Origin: origin },
    });
  return { app, base, request, session, socket };
}

function connected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
}

function acknowledged<T = unknown>(
  socket: Socket,
  event: string,
  data: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    socket
      .timeout(2_000)
      .emit(event, data, (error: Error | null, response: T) =>
        error ? reject(error) : resolve(response),
      );
  });
}

describe("HTTP and Socket.IO boundary", () => {
  it("requires authenticated same-origin confirmation and syncs a reset only to the owner's tabs", async () => {
    const { app, request, session, socket } = await fixture();
    const players = await Promise.all(
      Array.from({ length: 3 }, () => session()),
    );
    const owner = players[0];
    app.store.settle({
      id: "before-reset",
      mode: "standard",
      kind: "pvp",
      landlord: 0,
      winner: "farmers",
      multiplier: "15",
      doubles: [1, 1, 1],
      reason: "正常结束",
      replay: { complete: true },
      players: players.map(({ account }, index) => ({
        ...account,
        name: String(index),
      })),
    });
    const before = app.store.getAccount(owner.account.id)!;
    expect(before.balance).toBe("99700");
    const reset = (cookie: string, body: unknown, origin?: string) =>
      request("/api/me/reset-tokens", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      });
    expect((await reset("", { confirmed: true })).status).toBe(401);
    expect(
      (await reset(owner.cookie, { confirmed: true }, "https://evil.example"))
        .status,
    ).toBe(403);
    for (const confirmed of [undefined, false, "true"])
      expect((await reset(owner.cookie, { confirmed })).status).toBe(400);
    expect(app.store.getAccount(owner.account.id)).toEqual(before);

    const sockets = [
      socket(owner.cookie),
      socket(owner.cookie),
      socket(players[1].cookie),
    ];
    cleanup.push(async () => {
      sockets.forEach((s) => s.disconnect());
    });
    await Promise.all(sockets.map(connected));
    const updates: (Account | null)[] = [null, null, null];
    sockets.forEach((s, index) =>
      s.on("account", (account) => {
        updates[index] = account;
      }),
    );
    // Caller-supplied account IDs and amounts cannot redirect or change the reset.
    const response = await reset(owner.cookie, {
      confirmed: true,
      id: players[1].account.id,
      balance: "9999999",
    });
    expect(response.status).toBe(200);
    const expected = { ...before, balance: "100000" };
    expect(await response.json()).toEqual(expected);
    await expect
      .poll(() =>
        updates.slice(0, 2).every((account) => account?.balance === "100000"),
      )
      .toBe(true);
    expect(updates).toEqual([expected, expected, null]);
    expect(app.store.getAccount(players[1].account.id)?.balance).toBe("100150");
    expect((await reset(owner.cookie, { confirmed: true })).status).toBe(200);
    expect(app.store.getAccount(owner.account.id)).toEqual(expected);
  });

  it("rejects resets from seated players and spectators until they leave the room", async () => {
    const { app, request, session } = await fixture();
    const players = await Promise.all(
      Array.from({ length: 4 }, () => session()),
    );
    const accounts = players.map(({ account }) =>
      app.store.getAccount(account.id)!,
    );
    accounts.forEach((account, index) =>
      app.rooms.connect(account.id, `reset-test-${index}`),
    );
    const room = app.rooms.create(accounts[0], "standard", "pvp");
    accounts.slice(1).forEach((account) => app.rooms.join(account, room.code));
    const reset = (index: number) =>
      request("/api/me/reset-tokens", {
        method: "POST",
        headers: {
          Cookie: players[index].cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmed: true }),
      });
    expect((await reset(0)).status).toBe(409);
    accounts
      .slice(0, 3)
      .forEach((account, index) =>
        app.rooms.command(account.id, room.version, `ready-${index}`, {
          type: "ready",
        }),
      );
    const game = structuredClone(room.game);
    const version = room.version;
    for (let index = 0; index < players.length; index++) {
      expect((await reset(index)).status).toBe(409);
      expect(app.store.getAccount(accounts[index].id)).toEqual(accounts[index]);
    }
    expect(room.game).toEqual(game);
    expect(room.version).toBe(version);
    app.rooms.command(accounts[3].id, room.version, "spectator-exit", {
      type: "leave",
    });
    expect((await reset(3)).status).toBe(200);
  });

  it("persists a nickname and broadcasts it to all own tabs and room members", async () => {
    const { app, request, session, socket } = await fixture();
    const players = await Promise.all(
      Array.from({ length: 4 }, () => session()),
    );
    const sockets = [...players, players[0]].map(({ cookie }) =>
      socket(cookie),
    );
    cleanup.push(async () => {
      sockets.forEach((s) => s.disconnect());
    });
    await Promise.all(sockets.map(connected));
    const room = app.rooms.create(
      app.store.getAccount(players[0].account.id)!,
      "standard",
      "pvp",
    );
    players
      .slice(1)
      .forEach(({ account }) =>
        app.rooms.join(app.store.getAccount(account.id)!, room.code),
      );
    const views: (RoomView | null)[] = sockets.map(() => null);
    const accounts: (Account | null)[] = sockets.map(() => null);
    sockets.forEach((s, index) => {
      s.on("room", (view) => {
        views[index] = view;
      });
      s.on("account", (account) => {
        accounts[index] = account;
      });
    });
    const rename = (index: number, name: unknown) =>
      request("/api/me", {
        method: "PATCH",
        headers: {
          Cookie: players[index].cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
    const response = await rename(0, "新昵称🌿");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ...players[0].account,
      name: "新昵称🌿",
    });
    await expect
      .poll(() => views.every((view) => view?.seats[0]?.name === "新昵称🌿"))
      .toBe(true);
    await expect
      .poll(() => [0, 4].every((index) => accounts[index]?.name === "新昵称🌿"))
      .toBe(true);
    expect(accounts.slice(1, 4)).toEqual([null, null, null]);
    expect(views[3]?.mySeat).toBe(-1);
    expect((await rename(3, "观众新名")).status).toBe(200);
    await expect
      .poll(() =>
        views.every((view) => view?.spectators[0]?.name === "观众新名"),
      )
      .toBe(true);
    for (const name of [
      " ",
      "字".repeat(17),
      "坏\u0000昵称",
      { text: "invalid" },
    ])
      expect((await rename(0, name)).status).toBe(400);
    const me = await request("/api/me", {
      headers: { Cookie: players[0].cookie },
    });
    expect(await me.json()).toMatchObject({
      ...players[0].account,
      name: "新昵称🌿",
    });
    expect(
      (
        await request("/api/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "冒充" }),
        })
      ).status,
    ).toBe(401);
  });

  it("sets an HTTP-only session cookie and rejects missing identity or foreign write origin", async () => {
    const { request, session, base } = await fixture();
    expect((await request("/api/health")).status).toBe(200);
    expect((await request("/api/me")).status).toBe(401);
    expect(
      (
        await fetch(base + "/api/session", {
          method: "POST",
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    const { cookie, account } = await session();
    expect(cookie).toMatch(/^clear_session=[a-f0-9]{64}$/);
    const me = await request("/api/me", { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).id).toBe(account.id);
    expect(
      (
        await request("/api/session", {
          method: "POST",
          headers: { Cookie: cookie },
        })
      ).headers.get("set-cookie"),
    ).toBeNull();
  });

  it("restricts persisted replays to participants and returns history through the session", async () => {
    const { app, request, session } = await fixture();
    const a = await session(),
      b = await session(),
      c = await session(),
      outsider = await session();
    app.store.settle({
      id: "http-replay",
      mode: "standard",
      kind: "pvp",
      landlord: 0,
      winner: "farmers",
      multiplier: "15",
      doubles: [1, 1, 1],
      reason: "正常结束",
      replay: { marker: "private-replay" },
      players: [a, b, c].map(({ account }, index) => ({
        id: account.id,
        name: String(index),
        balance: "100000",
      })),
    });
    const allowed = await request("/api/replays/http-replay", {
      headers: { Cookie: a.cookie },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ marker: "private-replay" });
    const denied = await request("/api/replays/http-replay", {
      headers: { Cookie: outsider.cookie },
    });
    expect(denied.status).toBe(404);
    const anonymous = await request("/api/replays/http-replay");
    expect(anonymous.status).toBe(401);
    const history = await request("/api/history", {
      headers: { Cookie: a.cookie },
    });
    expect(await history.json()).toMatchObject([
      { id: "http-replay", delta: "-300", won: false },
    ]);
  });

  it("authenticates sockets and applies origin and room command checks", async () => {
    const { session, socket } = await fixture();
    const first = await session();
    const invalid = socket("clear_session=invalid");
    cleanup.push(async () => {
      invalid.disconnect();
    });
    await expect(connected(invalid)).rejects.toThrow();
    const wrongOrigin = socket(first.cookie, "https://evil.example");
    cleanup.push(async () => {
      wrongOrigin.disconnect();
    });
    await expect(connected(wrongOrigin)).rejects.toThrow();
    const authorized = socket(first.cookie);
    cleanup.push(async () => {
      authorized.disconnect();
    });
    await connected(authorized);
    const invalidRoom = await acknowledged<{ ok: boolean; error: string }>(
      authorized,
      "room.create",
      { mode: "bad", kind: "pvp" },
    );
    expect(invalidRoom).toMatchObject({ ok: false, error: "模式无效" });
    const created = await acknowledged<{
      ok: boolean;
      room: { code: string; mySeat: number };
    }>(authorized, "room.create", { mode: "standard", kind: "pvp" });
    expect(created).toMatchObject({ ok: true, room: { mySeat: 0 } });
    expect(created.room.code).toMatch(/^\d{6}$/);
    const malformed = await acknowledged<{ ok: boolean; error: string }>(
      authorized,
      "room.command",
      { version: 0, id: "", command: null },
    );
    expect(malformed).toMatchObject({ ok: false, error: "请求格式无效" });
  });

  it("accepts a same-site polling handshake without Origin and rejects a foreign Origin", async () => {
    const { base, session } = await fixture();
    const { cookie } = await session();
    const endpoint = `${base}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`;
    const accepted = await fetch(endpoint, {
      headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toMatch(/^0\{/);
    const denied = await fetch(endpoint + "-foreign", {
      headers: {
        Cookie: cookie,
        "Sec-Fetch-Site": "same-origin",
        Origin: "https://evil.example",
      },
    });
    expect(denied.status).toBe(403);
  });

  it("emits a null room snapshot after a server restart with a valid persistent session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "landlord-restart-"));
    const database = join(dir, "game.sqlite");
    let first = createApplication({ database });
    await new Promise<void>((resolve) =>
      first.http.listen(0, "127.0.0.1", resolve),
    );
    const firstBase = `http://127.0.0.1:${(first.http.address() as AddressInfo).port}`;
    const response = await fetch(firstBase + "/api/session", {
      method: "POST",
      headers: { Origin: firstBase },
    });
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const account = (await response.json()).account as { id: string };
    first.rooms.connect(account.id, "old-socket");
    first.rooms.create(first.store.getAccount(account.id)!, "standard", "pvp");
    expect(first.rooms.current(account.id)).toBeDefined();
    await first.close();
    const second = createApplication({ database });
    await new Promise<void>((resolve) =>
      second.http.listen(0, "127.0.0.1", resolve),
    );
    const secondBase = `http://127.0.0.1:${(second.http.address() as AddressInfo).port}`;
    const socket = socketClient(secondBase, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 2_000,
      extraHeaders: { Cookie: cookie, Origin: secondBase },
    });
    try {
      const firstRoomEvent = new Promise<unknown>((resolve) =>
        socket.once("room", resolve),
      );
      await connected(socket);
      const snapshot = await Promise.race([
        firstRoomEvent,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("room snapshot timed out")), 2_000),
        ),
      ]);
      expect(snapshot).toBeNull();
      expect(second.rooms.current(account.id)).toBeUndefined();
    } finally {
      socket.disconnect();
      await second.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
