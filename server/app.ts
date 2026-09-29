import express from "express";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { Store } from "./store.ts";
import { Rooms } from "./rooms.ts";
import type { Mode, Personality, RoomCommand } from "../shared/types.ts";

const cookie = (raw = "") =>
  raw
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("clear_session="))
    ?.slice(14) ?? "";
export function createApplication(
  options: {
    database?: string;
    origin?: string;
    secureCookie?: boolean;
    timing?: { bid: number; play: number; grace: number; bot: number };
  } = {},
) {
  const app = express(),
    http = createServer(app),
    store = new Store(
      options.database ??
        resolve(process.env.DATA_DIR ?? "data", "game.sqlite"),
    );
  const origin = options.origin ?? process.env.ORIGIN;
  if (process.env.NODE_ENV === "production" && !origin)
    throw new Error(
      "Production requires ORIGIN, e.g. https://cards.example.com",
    );
  const validOrigin = (value: string | undefined, host: string | undefined) =>
    !!value &&
    (value === origin ||
      (!origin &&
        [
          `http://${host}`,
          "http://127.0.0.1:5173",
          "http://localhost:5173",
        ].includes(value)));
  const io = new Server(http, {
    maxHttpBufferSize: 16384,
    allowRequest: (req, callback) =>
      callback(
        null,
        validOrigin(req.headers.origin, req.headers.host) ||
          (!req.headers.origin &&
            req.headers["sec-fetch-site"] === "same-origin"),
      ),
  });
  const rooms = new Rooms(
    store,
    (room) => {
      for (const id of room.members.keys())
        for (const socket of rooms.connections.get(id) ?? [])
          io.to(socket).emit("room", rooms.project(room, id));
    },
    options.timing,
  );
  const requests = new Map<string, { start: number; count: number }>();
  const allowed = (key: string, limit: number) => {
    const now = Date.now(),
      entry = requests.get(key);
    if (!entry || now - entry.start > 60000) {
      requests.set(key, { start: now, count: 1 });
      return true;
    }
    return ++entry.count <= limit;
  };
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Cache-Control",
      req.path.startsWith("/api") ? "no-store" : "no-cache",
    );
    if (
      req.method !== "GET" &&
      !validOrigin(req.headers.origin, req.headers.host)
    ) {
      res.status(403).json({ error: "请求来源不匹配" });
      return;
    }
    if (
      req.path.startsWith("/api") &&
      !allowed(`http:${req.socket.remoteAddress}`, 300)
    ) {
      res.status(429).json({ error: "操作过于频繁，请稍后重试" });
      return;
    }
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/session", (req, res) => {
    const existing = store.authenticate(cookie(req.headers.cookie));
    if (existing) {
      res.json({
        account: existing,
        roomCode: rooms.membership.get(existing.id) ?? null,
      });
      return;
    }
    if (!allowed(`guest:${req.socket.remoteAddress}`, 20)) {
      res.status(429).json({ error: "创建游客过于频繁" });
      return;
    }
    const { account, token } = store.createAccount();
    res.cookie("clear_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: options.secureCookie ?? process.env.COOKIE_SECURE === "true",
      maxAge: 365 * 86400000,
      path: "/",
    });
    res.json({ account, roomCode: null });
  });
  app.use("/api", (req, res, next) => {
    const account = store.authenticate(cookie(req.headers.cookie));
    if (!account) {
      res.status(401).json({ error: "身份已失效，请刷新页面" });
      return;
    }
    res.locals.account = account;
    next();
  });
  app.get("/api/me", (_req, res) => res.json(res.locals.account));
  app.patch("/api/me", (req, res) => {
    if (typeof req.body?.name !== "string") {
      res.status(400).json({ error: "请输入昵称" });
      return;
    }
    const account = rooms.rename(res.locals.account.id, req.body.name);
    for (const socket of rooms.connections.get(account.id) ?? [])
      io.to(socket).emit("account", account);
    res.json(account);
  });
  app.get("/api/history", (_req, res) =>
    res.json(store.getHistory(res.locals.account.id)),
  );
  app.get("/api/replays/:id", (req, res) => {
    const replay =
      store.getReplay(String(req.params.id), res.locals.account.id) ??
      rooms.spectatorReplay(res.locals.account.id, String(req.params.id));
    if (!replay) {
      res.status(404).json({ error: "没有找到这局回放" });
      return;
    }
    res.json(replay);
  });
  app.post("/api/relief", (_req, res) =>
    res.json(store.createRelief(res.locals.account.id)),
  );
  app.post("/api/relief/claim", (req, res) =>
    res.json(
      store.claimRelief(
        res.locals.account.id,
        String(req.body?.id ?? ""),
        String(req.body?.answer ?? ""),
      ),
    ),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) =>
      res
        .status(400)
        .json({ error: error instanceof Error ? error.message : "操作失败" }),
  );
  io.use((socket, next) => {
    const account = store.authenticate(cookie(socket.request.headers.cookie));
    if (!account) return next(new Error("身份失效"));
    socket.data.account = account;
    next();
  });
  io.on("connection", (socket) => {
    const id: string = socket.data.account.id;
    rooms.connect(id, socket.id);
    const resumed = rooms.current(id);
    socket.emit("room", resumed ? rooms.project(resumed, id) : null);
    const respond =
      (handler: (data: any) => unknown) =>
      (data: any, ack?: (response: unknown) => void) => {
        if (typeof ack !== "function") return;
        try {
          if (!allowed(`socket:${id}`, 240)) throw new Error("操作过于频繁");
          const result = handler(data ?? {});
          ack({ ok: true, ...(result ?? {}) });
        } catch (error) {
          ack({
            ok: false,
            error: error instanceof Error ? error.message : "操作失败",
          });
        }
      };
    socket.on(
      "room.create",
      respond((data) => {
        if (
          !["standard", "wild"].includes(data.mode) ||
          !["pve", "pvp"].includes(data.kind)
        )
          throw new Error("模式无效");
        const personalities: Personality[] = data.personalities ?? [
          "cautious",
          "bold",
        ];
        if (
          !Array.isArray(personalities) ||
          personalities.length !== 2 ||
          personalities.some(
            (p) => !["cautious", "balanced", "bold"].includes(p),
          )
        )
          throw new Error("人格无效");
        const room = rooms.create(
          store.getAccount(id)!,
          data.mode as Mode,
          data.kind,
          personalities,
        );
        return { room: rooms.project(room, id) };
      }),
    );
    socket.on(
      "room.join",
      respond((data) => {
        if (!/^\d{6}$/.test(data.code)) throw new Error("请输入六位房间码");
        const room = rooms.join(store.getAccount(id)!, data.code);
        return { room: rooms.project(room, id) };
      }),
    );
    socket.on(
      "room.command",
      respond((data) => {
        if (
          !Number.isInteger(data.version) ||
          typeof data.id !== "string" ||
          data.id.length > 80 ||
          !data.command ||
          typeof data.command.type !== "string"
        )
          throw new Error("请求格式无效");
        rooms.command(id, data.version, data.id, data.command as RoomCommand);
        const room = rooms.current(id);
        if (!room)
          for (const connection of rooms.connections.get(id) ?? [])
            io.to(connection).emit("room", null);
        return {
          room: room ? rooms.project(room, id) : null,
          account: store.getAccount(id),
        };
      }),
    );
    socket.on(
      "room.hint",
      respond(() => rooms.hint(id)),
    );
    socket.on("disconnect", () => rooms.disconnect(id, socket.id));
  });
  const timer = setInterval(() => {
    rooms.tick();
    if (requests.size > 1000)
      for (const [key, value] of requests)
        if (Date.now() - value.start > 60000) requests.delete(key);
  }, 200);
  timer.unref();
  return {
    app,
    http,
    io,
    store,
    rooms,
    close: async () => {
      clearInterval(timer);
      await new Promise<void>((r) => io.close(() => r()));
      store.close();
    },
  };
}
