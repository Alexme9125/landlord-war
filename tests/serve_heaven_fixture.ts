// Isolated CLI fixture: a legal 20-card landlord hand with a twelve-card bomb.
// Uses the production server and engine without adding any HTTP test endpoint.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApplication } from "../server/app.ts";
import { deck } from "../shared/cards.ts";
import { createGame } from "../shared/engine.ts";
import type { RoomCommand } from "../shared/types.ts";

const directory = process.env.DATA_DIR;
if (!directory) throw new Error("Supply an isolated test DATA_DIR");
const port = Number(process.env.PORT ?? 3184);
const origin = `http://127.0.0.1:${port}`;
const application = createApplication({
  database: resolve(directory, "game.sqlite"),
  origin,
  secureCookie: false,
  timing: { bid: 300_000, play: 300_000, grace: 60_000, bot: 900 },
});
const players = ["天行", "听雨", "远山"].map((name) =>
  application.store.createAccount(name),
);
players.forEach((p, i) =>
  application.rooms.connect(p.account.id, `fixture-${i}`),
);
const room = application.rooms.create(
  players[0].account,
  "heaven-earth",
  "pvp",
);
players.slice(1).forEach((p) => application.rooms.join(p.account, room.code));
let serial = 0;
const command = (seat: number, action: RoomCommand) =>
  application.rooms.command(
    players[seat].account.id,
    room.version,
    `fixture-${++serial}`,
    action,
  );
players.forEach((_, seat) => command(seat, { type: "ready" }));
const all = deck();
const selected = all.filter((c) => [3, 7, 9].includes(c.rank));
const extra = ["4S", "4H", "5S", "5H", "6S"];
const bottom = ["11S", "12H", "14D"];
const first = [
  ...selected,
  ...extra.map((id) => all.find((c) => c.id === id)!),
];
const rest = all.filter(
  (c) => !first.some((p) => p.id === c.id) && !bottom.includes(c.id),
);
room.game = createGame(
  "heaven-earth-browser",
  "heaven-earth",
  [...first, ...rest, ...bottom.map((id) => all.find((c) => c.id === id)!)],
  0,
  9,
  10,
  7,
);
command(0, { type: "game", action: { type: "bid", yes: true } });
command(1, { type: "game", action: { type: "bid", yes: false } });
command(2, { type: "game", action: { type: "bid", yes: false } });
players.forEach((_, seat) =>
  command(seat, { type: "game", action: { type: "double", yes: false } }),
);
mkdirSync(directory, { recursive: true });
writeFileSync(
  resolve(directory, "heaven-fixture.json"),
  JSON.stringify({
    tokens: players.map((p) => p.token),
    selected: selected.map((c) => c.id),
  }),
);
application.http.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  process.stdout.write(`Heaven/earth browser fixture on ${origin}\n`),
);
