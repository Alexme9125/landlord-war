import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Account, SettlementLine } from "../shared/types.js";
import {
  parseBaseStake,
  MODES,
  type Mode,
  type BaseStake,
  type ReliefChallenge,
} from "../shared/types.ts";

const STARTING_BALANCE = 100_000n;
const RELIEF_AMOUNT = 10_000n;
const BOT_BALANCE = 100_000n;
const TOKEN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const RELIEF_LIFETIME_MS = 5 * 60 * 1000;

type SettlementInput = {
  id: string;
  mode: Mode;
  kind: "pve" | "pvp";
  landlord: number;
  winner: "landlord" | "farmers";
  multiplier: string;
  baseStake?: BaseStake;
  doubles: number[];
  players: { id: string; name: string; balance: string; bot?: boolean }[];
  reason: string;
  replay: unknown;
};

type DbAccount = {
  id: string;
  name: string;
  balance: string;
  games: number;
  wins: number;
};
type DbChallenge = {
  answer: string;
  expires_at: number;
  used_at: number | null;
};

export class ReliefAnswerError extends Error {
  constructor(readonly challenge: ReliefChallenge) {
    super("这都答不对的人是不配领救济的");
  }
}

function amount(value: string, label: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error(`${label}必须是非负整数`);
  return BigInt(value);
}

function validName(name: string): string {
  const trimmed = name.trim();
  if (
    Array.from(trimmed).length < 1 ||
    Array.from(trimmed).length > 16 ||
    /\p{Cc}/u.test(trimmed)
  ) {
    throw new Error("昵称须为1到16个字符，且不能包含控制字符");
  }
  return trimmed;
}

function toAccount(row: DbAccount): Account {
  return {
    id: row.id,
    name: row.name,
    balance: row.balance,
    games: row.games,
    wins: row.wins,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Durable account and settlement storage. All money calculations use bigint. */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path = "data/game.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, balance TEXT NOT NULL,
        games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tokens (
        hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL, kind TEXT NOT NULL,
        at INTEGER NOT NULL, winner TEXT NOT NULL, reason TEXT NOT NULL,
        replay TEXT NOT NULL, lines TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_participants (
        game_id TEXT NOT NULL REFERENCES games(id), account_id TEXT NOT NULL REFERENCES accounts(id),
        seat INTEGER NOT NULL, delta TEXT NOT NULL, won INTEGER NOT NULL,
        PRIMARY KEY (game_id, account_id)
      );
      CREATE INDEX IF NOT EXISTS game_participants_account ON game_participants(account_id, game_id);
      CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        game_id TEXT, kind TEXT NOT NULL, at INTEGER NOT NULL, delta TEXT NOT NULL, balance TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS relief_challenges (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        answer TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private transaction<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private account(id: string): Account | null {
    const row = this.db
      .prepare("SELECT * FROM accounts WHERE id = ?")
      .get(id) as DbAccount | undefined;
    return row ? toAccount(row) : null;
  }

  createAccount(name?: string): { account: Account; token: string } {
    const id = randomUUID();
    const token = randomBytes(32).toString("hex");
    const selectedName = validName(name ?? `玩家${id.slice(0, 6)}`);
    return this.transaction(() => {
      this.db
        .prepare("INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)")
        .run(id, selectedName, STARTING_BALANCE.toString());
      this.db
        .prepare(
          "INSERT INTO tokens (hash, account_id, expires_at) VALUES (?, ?, ?)",
        )
        .run(hashToken(token), id, Date.now() + TOKEN_LIFETIME_MS);
      return { account: this.account(id)!, token };
    });
  }

  authenticate(token: string): Account | null {
    if (!/^[a-f0-9]{64}$/i.test(token)) return null;
    const row = this.db
      .prepare(
        "SELECT account_id FROM tokens WHERE hash = ? AND expires_at > ?",
      )
      .get(hashToken(token), Date.now()) as { account_id: string } | undefined;
    return row ? this.account(row.account_id) : null;
  }

  getAccount(id: string): Account | null {
    return this.account(id);
  }

  rename(id: string, name: string): Account {
    const selectedName = validName(name);
    return this.transaction(() => {
      if (!this.account(id)) throw new Error("账户不存在");
      this.db
        .prepare("UPDATE accounts SET name = ? WHERE id = ?")
        .run(selectedName, id);
      return this.account(id)!;
    });
  }

  resetTokens(id: string): Account {
    return this.transaction(() => {
      const account = this.account(id);
      if (!account) throw new Error("账户不存在");
      const delta = STARTING_BALANCE - amount(account.balance, "余额");
      const now = Date.now();
      this.db
        .prepare("UPDATE accounts SET balance = ? WHERE id = ?")
        .run(STARTING_BALANCE.toString(), id);
      this.db
        .prepare(
          "INSERT INTO ledger (id, account_id, kind, at, delta, balance) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          id,
          "reset",
          now,
          delta.toString(),
          STARTING_BALANCE.toString(),
        );
      this.db
        .prepare(
          "UPDATE relief_challenges SET used_at = ? WHERE account_id = ? AND used_at IS NULL",
        )
        .run(now, id);
      return this.account(id)!;
    });
  }

  getHistory(id: string): {
    id: string;
    mode: string;
    kind: string;
    at: number;
    delta: string;
    won: boolean;
  }[] {
    return this.db
      .prepare(
        `
      SELECT g.id, g.mode, g.kind, g.at, p.delta, p.won
      FROM game_participants p JOIN games g ON g.id = p.game_id
      WHERE p.account_id = ? ORDER BY g.at DESC, g.rowid DESC LIMIT 20
    `,
      )
      .all(id)
      .map((row) => ({
        id: String(row.id),
        mode: String(row.mode),
        kind: String(row.kind),
        at: Number(row.at),
        delta: String(row.delta),
        won: Number(row.won) === 1,
      }));
  }

  getReplay(id: string, accountId: string): unknown | null {
    const row = this.db
      .prepare(
        `
      SELECT g.replay FROM games g JOIN game_participants p ON p.game_id = g.id
      WHERE g.id = ? AND p.account_id = ?
    `,
      )
      .get(id, accountId) as { replay: string } | undefined;
    return row ? JSON.parse(row.replay) : null;
  }

  private newReliefChallenge(
    id: string,
    previousAnswer?: string,
  ): ReliefChallenge {
    const a = (randomBytes(1)[0] % 50) + 1;
    let b = (randomBytes(1)[0] % 50) + 1;
    // A different sum guarantees a different question, even if random draws repeat.
    if (String(a + b) === previousAnswer) b = b === 50 ? 1 : b + 1;
    const challengeId = randomUUID();
    this.db
      .prepare(
        "INSERT INTO relief_challenges (id, account_id, answer, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(challengeId, id, String(a + b), Date.now() + RELIEF_LIFETIME_MS);
    return { id: challengeId, question: `${a} + ${b} = ?` };
  }

  createRelief(id: string): ReliefChallenge {
    return this.transaction(() => {
      const account = this.account(id);
      if (!account) throw new Error("账户不存在");
      if (amount(account.balance, "余额") !== 0n)
        throw new Error("余额为零时才能领取救济");
      return this.newReliefChallenge(id);
    });
  }

  claimRelief(id: string, challengeId: string, answer: string): Account {
    const result = this.transaction(() => {
      const account = this.account(id);
      if (!account) throw new Error("账户不存在");
      if (amount(account.balance, "余额") !== 0n)
        throw new Error("余额为零时才能领取救济");
      const challenge = this.db
        .prepare(
          "SELECT answer, expires_at, used_at FROM relief_challenges WHERE id = ? AND account_id = ?",
        )
        .get(challengeId, id) as DbChallenge | undefined;
      if (
        !challenge ||
        challenge.used_at !== null ||
        challenge.expires_at <= Date.now()
      ) {
        throw new Error("救济题目无效或已过期");
      }
      const now = Date.now();
      this.db
        .prepare("UPDATE relief_challenges SET used_at = ? WHERE id = ?")
        .run(now, challengeId);
      if (String(answer).trim() !== challenge.answer) {
        return new ReliefAnswerError(
          this.newReliefChallenge(id, challenge.answer),
        );
      }
      this.db
        .prepare("UPDATE accounts SET balance = ? WHERE id = ?")
        .run(RELIEF_AMOUNT.toString(), id);
      this.db
        .prepare(
          "INSERT INTO ledger (id, account_id, kind, at, delta, balance) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          id,
          "relief",
          now,
          RELIEF_AMOUNT.toString(),
          RELIEF_AMOUNT.toString(),
        );
      return this.account(id)!;
    });
    // Commit the old question's invalidation and its replacement before reporting a wrong answer.
    if (result instanceof ReliefAnswerError) throw result;
    return result;
  }

  settle(input: SettlementInput): SettlementLine[] {
    return this.transaction(() => {
      const saved = this.db
        .prepare("SELECT lines FROM games WHERE id = ?")
        .get(input.id) as { lines: string } | undefined;
      if (saved) return JSON.parse(saved.lines) as SettlementLine[];
      if (
        !input.id ||
        input.players.length !== 3 ||
        ![0, 1, 2].includes(input.landlord) ||
        input.doubles.length !== 3 ||
        !MODES.includes(input.mode) ||
        !["pve", "pvp"].includes(input.kind) ||
        !["landlord", "farmers"].includes(input.winner) ||
        new Set(input.players.map((p) => p.id)).size !== 3
      )
        throw new Error("结算参数无效");
      const multiplier = amount(input.multiplier, "倍数");
      const baseStake = BigInt(
        parseBaseStake(input.baseStake === undefined ? 10 : input.baseStake),
      );
      if (multiplier < 1n || !input.doubles.every((d) => d === 1 || d === 2))
        throw new Error("倍数无效");
      const before = input.players.map((player) => {
        if (player.bot) return BOT_BALANCE;
        const account = this.account(player.id);
        if (!account) throw new Error("结算账户不存在");
        return amount(account.balance, "余额");
      });
      const farmerSeats = [0, 1, 2].filter((seat) => seat !== input.landlord);
      const obligations = farmerSeats.map(
        (seat) =>
          baseStake *
          multiplier *
          BigInt(input.doubles[input.landlord]) *
          BigInt(input.doubles[seat]),
      );
      const deltas = [0n, 0n, 0n];
      if (input.winner === "landlord") {
        farmerSeats.forEach((seat, index) => {
          const paid =
            before[seat] < obligations[index]
              ? before[seat]
              : obligations[index];
          deltas[seat] = -paid;
          deltas[input.landlord] += paid;
        });
      } else {
        const total = obligations[0] + obligations[1];
        const paid =
          before[input.landlord] < total ? before[input.landlord] : total;
        const shares = obligations.map((owed) => (paid * owed) / total);
        let remainder = paid - shares[0] - shares[1];
        const ranking = [0, 1].sort((a, b) => {
          const aRem = (paid * obligations[a]) % total;
          const bRem = (paid * obligations[b]) % total;
          return aRem === bRem
            ? farmerSeats[a] - farmerSeats[b]
            : aRem > bRem
              ? -1
              : 1;
        });
        for (const index of ranking) {
          if (remainder === 0n) break;
          shares[index] += 1n;
          remainder -= 1n;
        }
        farmerSeats.forEach((seat, index) => {
          deltas[seat] = shares[index];
        });
        deltas[input.landlord] = -paid;
      }
      const lines = input.players.map((player, seat) => ({
        id: player.id,
        name: player.name,
        before: before[seat].toString(),
        delta: deltas[seat].toString(),
        after: (before[seat] + deltas[seat]).toString(),
      }));
      const now = Date.now();
      this.db
        .prepare(
          "INSERT INTO games (id, mode, kind, at, winner, reason, replay, lines) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.mode,
          input.kind,
          now,
          input.winner,
          input.reason,
          JSON.stringify(input.replay),
          JSON.stringify(lines),
        );
      input.players.forEach((player, seat) => {
        if (player.bot) return;
        const won =
          input.winner === "landlord"
            ? seat === input.landlord
            : seat !== input.landlord;
        this.db
          .prepare(
            "UPDATE accounts SET balance = ?, games = games + 1, wins = wins + ? WHERE id = ?",
          )
          .run(lines[seat].after, won ? 1 : 0, player.id);
        this.db
          .prepare(
            "INSERT INTO game_participants (game_id, account_id, seat, delta, won) VALUES (?, ?, ?, ?, ?)",
          )
          .run(input.id, player.id, seat, lines[seat].delta, won ? 1 : 0);
        this.db
          .prepare(
            "INSERT INTO ledger (id, account_id, game_id, kind, at, delta, balance) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            randomUUID(),
            player.id,
            input.id,
            "game",
            now,
            lines[seat].delta,
            lines[seat].after,
          );
      });
      return lines;
    });
  }
}
