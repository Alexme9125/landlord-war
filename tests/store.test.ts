import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../server/store.js";

const opened: Store[] = [];
const dirs: string[] = [];
function store(path = ":memory:"): Store {
  const instance = new Store(path);
  opened.push(instance);
  return instance;
}
afterEach(() => {
  vi.useRealTimers();
  while (opened.length) opened.pop()!.close();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function setup(s: Store) {
  const accounts = ["甲", "乙", "丙", "丁"].map((name) =>
    s.createAccount(name),
  );
  const players: {
    id: string;
    name: string;
    balance: string;
    bot?: boolean;
  }[] = accounts.slice(0, 3).map(({ account }) => ({
    id: account.id,
    name: account.name,
    balance: "999999999999",
  }));
  return { accounts, players };
}

function input(
  players: { id: string; name: string; balance: string; bot?: boolean }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "game-1",
    mode: "standard" as const,
    kind: "pvp" as const,
    landlord: 0,
    winner: "farmers" as const,
    multiplier: "10000",
    doubles: [1, 1, 2],
    players,
    reason: "正常结束",
    replay: { turns: [1, 2, 3] },
    ...overrides,
  };
}

describe("Store", () => {
  it("resets balances up or down to 100K atomically while preserving account history", () => {
    const dir = mkdtempSync(join(tmpdir(), "landlord-reset-"));
    dirs.push(dir);
    const path = join(dir, "game.sqlite");
    const s = store(path);
    const { accounts, players } = setup(s);
    s.settle(input(players));
    const loser = s.getAccount(accounts[0].account.id)!;
    const winner = s.getAccount(accounts[1].account.id)!;
    const history = s.getHistory(loser.id);
    const replay = s.getReplay("game-1", loser.id);
    expect(loser.balance).toBe("0");
    expect(winner.balance).toBe("133333");
    expect(s.resetTokens(loser.id)).toEqual({ ...loser, balance: "100000" });
    expect(s.resetTokens(winner.id)).toEqual({ ...winner, balance: "100000" });
    expect(s.resetTokens(loser.id)).toEqual({ ...loser, balance: "100000" });
    expect(s.getHistory(loser.id)).toEqual(history);
    expect(s.getReplay("game-1", loser.id)).toEqual(replay);
    expect(s.authenticate(accounts[0].token)).toEqual({
      ...loser,
      balance: "100000",
    });
    expect(() => s.resetTokens("missing-account")).toThrow("账户不存在");
    s.close();
    opened.pop();
    const reopened = store(path);
    expect(reopened.authenticate(accounts[0].token)).toEqual({
      ...loser,
      balance: "100000",
    });
    const audit = new DatabaseSync(path, { readOnly: true });
    try {
      expect(
        audit
          .prepare(
            "SELECT delta, balance FROM ledger WHERE kind = 'reset' ORDER BY rowid",
          )
          .all(),
      ).toEqual([
        { delta: "100000", balance: "100000" },
        { delta: "-33333", balance: "100000" },
        { delta: "0", balance: "100000" },
      ]);
    } finally {
      audit.close();
    }
  });

  it("invalidates old relief challenges when resetting Tokens", () => {
    const s = store();
    const { accounts, players } = setup(s);
    const id = accounts[0].account.id;
    s.settle(input(players));
    const challenge = s.createRelief(id);
    const numbers = challenge.question.match(/^(\d+) \+ (\d+)/)!;
    const answer = String(Number(numbers[1]) + Number(numbers[2]));
    s.resetTokens(id);
    s.settle(input(players, { id: "game-after-reset" }));
    expect(s.getAccount(id)?.balance).toBe("0");
    expect(() => s.claimRelief(id, challenge.id, answer)).toThrow(
      "无效或已过期",
    );
    expect(s.getAccount(id)?.balance).toBe("0");
  });

  it("persists accounts and authenticates only the bearer token", () => {
    const dir = mkdtempSync(join(tmpdir(), "landlord-store-"));
    dirs.push(dir);
    const path = join(dir, "game.sqlite");
    const first = store(path);
    const { account, token } = first.createAccount("  测试玩家  ");
    expect(account).toMatchObject({
      name: "测试玩家",
      balance: "100000",
      games: 0,
      wins: 0,
    });
    expect(first.authenticate(token)?.id).toBe(account.id);
    expect(first.authenticate("wrong")).toBeNull();
    expect(first.rename(account.id, "新名字").name).toBe("新名字");
    expect(() => first.rename(account.id, "a\u0000b")).toThrow("昵称");
    first.close();
    opened.pop();
    const second = store(path);
    expect(second.authenticate(token)).toMatchObject({
      id: account.id,
      name: "新名字",
    });
  });

  it("splits a bankrupt landlord payment proportionally with largest-remainder rounding", () => {
    const s = store();
    const { accounts, players } = setup(s);
    const lines = s.settle(input(players));
    expect(lines.map((line) => line.delta)).toEqual([
      "-100000",
      "33333",
      "66667",
    ]);
    expect(lines.map((line) => line.after)).toEqual(["0", "133333", "166667"]);
    expect(lines.reduce((sum, line) => sum + BigInt(line.delta), 0n)).toBe(0n);
    expect(s.getAccount(accounts[0].account.id)).toMatchObject({
      balance: "0",
      games: 1,
      wins: 0,
    });
    expect(s.getAccount(accounts[1].account.id)).toMatchObject({
      balance: "133333",
      games: 1,
      wins: 1,
    });
    expect(s.getHistory(accounts[1].account.id)[0]).toMatchObject({
      id: "game-1",
      delta: "33333",
      won: true,
    });
    expect(s.getReplay("game-1", accounts[0].account.id)).toEqual({
      turns: [1, 2, 3],
    });
    expect(s.getReplay("game-1", accounts[3].account.id)).toBeNull();
  });

  it("returns saved settlement on retry without changing wallets or stats", () => {
    const s = store();
    const { accounts, players } = setup(s);
    const first = s.settle(input(players));
    const second = s.settle(
      input(players, { multiplier: "1", winner: "landlord" }),
    );
    expect(second).toEqual(first);
    expect(s.getAccount(accounts[0].account.id)).toMatchObject({
      balance: "0",
      games: 1,
    });
    expect(s.getHistory(accounts[0].account.id)).toHaveLength(1);
  });

  it("caps each losing farmer, handles huge multipliers, and keeps bots in zero-sum lines", () => {
    const s = store();
    const { accounts, players } = setup(s);
    players[2] = { id: "bot-1", name: "电脑", balance: "1", bot: true };
    const lines = s.settle(
      input(players, {
        winner: "landlord",
        multiplier: "9999999999999999999999999999999999999999999",
      }),
    );
    expect(lines.map((line) => line.delta)).toEqual([
      "200000",
      "-100000",
      "-100000",
    ]);
    expect(lines[2].before).toBe("100000");
    expect(lines.reduce((sum, line) => sum + BigInt(line.delta), 0n)).toBe(0n);
    expect(s.getAccount(accounts[0].account.id)?.balance).toBe("300000");
    expect(s.getAccount(accounts[2].account.id)?.games).toBe(0);
  });

  it("awards one relief payment for a correct unexpired challenge after bankruptcy", () => {
    const s = store();
    const { accounts, players } = setup(s);
    const id = accounts[0].account.id;
    expect(() => s.createRelief(id)).toThrow("余额为零");
    s.settle(input(players));
    const challenge = s.createRelief(id);
    const match = challenge.question.match(/^(\d+) \+ (\d+) = \?$/);
    expect(match).not.toBeNull();
    expect(() => s.claimRelief(id, challenge.id, "wrong")).toThrow("答案");
    const answer = String(Number(match![1]) + Number(match![2]));
    expect(s.claimRelief(id, challenge.id, answer).balance).toBe("10000");
    expect(() => s.claimRelief(id, challenge.id, answer)).toThrow("余额为零");
    expect(() =>
      s.claimRelief(accounts[1].account.id, challenge.id, answer),
    ).toThrow();
  });

  it("expires relief challenges and allows relief after another bankruptcy", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const s = store();
    const { accounts, players } = setup(s);
    const id = accounts[0].account.id;
    s.settle(input(players));
    const expired = s.createRelief(id);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(() => s.claimRelief(id, expired.id, "0")).toThrow("过期");
    const valid = s.createRelief(id);
    const answer = valid.question.match(/^(\d+) \+ (\d+)/)!;
    s.claimRelief(id, valid.id, String(Number(answer[1]) + Number(answer[2])));
    s.settle(input(players, { id: "game-2" }));
    expect(s.getAccount(id)?.balance).toBe("0");
    const again = s.createRelief(id);
    const nextAnswer = again.question.match(/^(\d+) \+ (\d+)/)!;
    expect(
      s.claimRelief(
        id,
        again.id,
        String(Number(nextAnswer[1]) + Number(nextAnswer[2])),
      ).balance,
    ).toBe("10000");
  });

  it("rolls back a failed replay serialization before any balance update", () => {
    const s = store();
    const { accounts, players } = setup(s);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => s.settle(input(players, { replay: circular }))).toThrow();
    expect(s.getAccount(accounts[0].account.id)).toMatchObject({
      balance: "100000",
      games: 0,
    });
    expect(s.getHistory(accounts[0].account.id)).toHaveLength(0);
    expect(s.settle(input(players))).toHaveLength(3);
  });
});
