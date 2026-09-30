// CLI-only fixture for an isolated browser-test database; no test endpoint is exposed.
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.ts";

const path = process.argv[2];
if (!path) throw new Error("Supply an isolated browser-test SQLite path");
const store = new Store(path);
try {
  const { account, token } = store.createAccount("救济测试玩家");
  store.settle({
    id: randomUUID(),
    mode: "standard",
    kind: "pve",
    landlord: 0,
    winner: "farmers",
    multiplier: "10000",
    doubles: [1, 1, 1],
    players: [
      account,
      ...[1, 2].map((seat) => ({
        id: `fixture-bot-${seat}`,
        name: `陪练${seat}`,
        balance: "100000",
        bot: true,
      })),
    ],
    reason: "浏览器验收：零余额账户",
    replay: { fixture: true },
  });
  process.stdout.write(JSON.stringify({ token }));
} finally {
  store.close();
}
