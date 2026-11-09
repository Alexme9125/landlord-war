**English** | [简体中文](README.zh-CN.md)

![Darwin Landlord](docs/branding/readme-banner.webp)

# Darwin Landlord

A browser-based three-player Dou Dizhu card game. Play solo against two AI bots or join friends with a six-character room code. The frontend uses React 19 and Vite, while the server runs on Express 5, Socket.IO 4, and Node.js built-in SQLite. The web interface is in Chinese.

You can play Standard, Four-Wildcard, or Heaven-Earth Wildcard. Heaven-Earth mode reveals a Heaven wildcard before bidding and an Earth wildcard after bidding settles the landlord, with bombs up to 12 cards. In solo play, each AI bot has its own nickname, difficulty (`恍惚` Dazed, `温和` Gentle, or `凌厉` Fierce), and playstyle (`谨慎` Cautious, `平衡` Balanced, or `激进` Bold). Multiplayer rooms start automatically once three players are ready, and extra visitors join as spectators. During play, the active player can pause the turn clock, while disconnected players have 60 seconds to reconnect.

New accounts start with 100 KTokens and can play at 10, 20, or 50 Token base stakes. When your balance hits zero, you can answer an addition question for 10 KTokens or reset your balance to 100 KTokens on the home screen. Recent history keeps the last 20 finished games with full-hand step-by-step replays. Both light and dark themes work across desktop and mobile layouts ([Desktop table](docs/screenshots/table-desktop.png) · [Mobile table](docs/screenshots/table-mobile.png)).

## Local development

Install Node.js 24 or later.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. The Vite dev server forwards `/api` and `/socket.io` traffic to `127.0.0.1:3001`.

To change the default ports, pass `PORT`, `VITE_PORT`, and `ORIGIN` together.

```sh
PORT=3171 VITE_PORT=5187 ORIGIN=http://127.0.0.1:5187 npm run dev
```

`ORIGIN` must match the exact URL in the browser address bar. Do not mix `localhost` and `127.0.0.1`.

## Deployment

### Direct Node.js process

Build the frontend first. A single Node.js process then serves the static files and the API/Socket.IO endpoints on one port.

```sh
npm run build
ORIGIN=http://127.0.0.1:3001 COOKIE_SECURE=false npm start
```

`ORIGIN` is required when `NODE_ENV=production`. `npm start` does not load `.env` automatically, so export environment variables before starting the process.

### Docker Compose

```sh
cp .env.example .env
# Set ORIGIN in .env to your public HTTPS origin, e.g. https://game.example.com
docker compose up -d --build
```

The container binds to `127.0.0.1:3001` on the host and stores the SQLite database in the `landlord-war-data` Docker volume. For public HTTPS access, place a reverse proxy with WebSocket upgrade support in front of the port; see [`deploy/nginx.conf`](deploy/nginx.conf) for a sample Nginx config and [`deploy/backup.sh`](deploy/backup.sh) to back up the volume. Restarting the server ends any unfinished matches in memory.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP and Socket.IO listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `ORIGIN` | Localhost origins in dev | Exact browser origin (e.g. `https://game.example.com`), required when `NODE_ENV=production` |
| `COOKIE_SECURE` | `true` in production | Sends the session cookie over HTTPS only when `true`; set `false` for local HTTP testing |
| `DATA_DIR` | `data` | Directory for the `game.sqlite` database file |

## Testing and documentation

```sh
npm test        # Vitest unit and integration tests
npm run check   # TypeScript type check
npm run build   # Type check and production build
```

The guides in `docs/` are in Chinese.

- [Game rules](docs/RULES.md)
- [AI difficulty and styles](docs/AI.md)
- [Deployment and backup](docs/DEPLOYMENT.md)
- [Architecture and API](docs/ARCHITECTURE.md)
- [Acceptance test log](docs/ACCEPTANCE.md)

## About

Created by Alex Xiao, with implementation assistance from OpenAI [Codex](https://github.com/codex) and ChatGPT (Vibe Coding).

[MIT License](LICENSE) · [Project logo](docs/branding/logo.png)
