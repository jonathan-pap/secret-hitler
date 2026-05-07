# Secret Hitler — Online

A modern, multiplayer browser version of the social deduction game.
Each player joins on their own device. The server holds authoritative
state and reveals only what each player is allowed to see.

## Quick start

Requires Node.js 18+.

**Windows (one click):**

Double-click `start.bat`. It installs dependencies the first time and
starts the server.

**Manual:**

```
npm install
npm start
```

The server prints URLs for both `localhost` and your local network IP.

## Playing

1. The host opens the URL and clicks **Create Game** — they get a
   4-letter room code (e.g. `ABCD`).
2. Other players open the same URL on their phones / laptops, click
   **Join with Code**, and enter the code + their name.
3. When 5–10 players are in the lobby, the host clicks **Begin Game**.
4. Each player privately sees their own role on their own device.
5. The host clicks **Start First Round** — the game begins.

## Network setup

- **Same Wi-Fi network**: share the IP-address URL printed in the
  console (e.g. `http://192.168.1.42:3000`). Players on the same
  network can join directly.
- **Over the internet**:
  - Easiest tunneling: install [ngrok](https://ngrok.com/) and run
    `ngrok http 3000` — gives you a public URL instantly.
  - Permanent host: push this repo to GitHub and deploy to one of:
    - **Render** ([render.com](https://render.com)) — free tier, auto-detects
      `render.yaml`. New Web Service → connect repo → done.
    - **Railway** ([railway.app](https://railway.app)) — `npm start` works as-is.
    - **Fly.io** — `fly launch` and accept defaults.
  - All three honor `process.env.PORT`, which `server.js` already uses.

## GitHub Pages won't work

This game needs a live WebSocket server to coordinate players. GitHub
Pages only serves static files, so it cannot host the multiplayer
backend. Use any of the deploy targets above instead — they're all
free for low traffic.

## Push to GitHub

```bash
git init
git add .
git commit -m "Secret Hitler online"
git remote add origin git@github.com:YOU/secret-hitler.git
git push -u origin main
```

The included `.gitignore` excludes `node_modules` so only ~5 source
files end up in the repo.

## Project layout

```
.
├── server.js            Node WebSocket + static server (game logic lives here)
├── package.json
├── start.bat            Windows convenience launcher
└── public/
    ├── index.html       Welcome / lobby / game / end screens
    ├── styles.css       All styling
    └── client.js        Renders server state, sends actions
```

## Game features

- 5–10 player support with correct role distribution per the official rules
- All four executive powers (Investigate, Peek, Special Election, Execution)
- Hitler-as-Chancellor instant win after 3 fascist policies
- Veto power unlocked after 5 fascist policies
- Election tracker with chaos-policy on 3 failed elections
- Reconnect-by-token (refresh the page mid-game and you stay seated)
- Per-player private info: hands, peek results, investigation results,
  fascist team membership

## Browser support

Modern Chrome / Edge / Firefox / Safari. Designed mobile-first; works
well on phones held in portrait.
