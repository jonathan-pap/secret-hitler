# Secret Hitler — Online

> ### 🎮 Play it now: **[secret-hitler-tt29.onrender.com](https://secret-hitler-tt29.onrender.com/)**
>
> No install. Open the link, **Create Game**, share the 4-letter room code
> with friends. 5–10 players. ~30 minutes per game.

A modern, multiplayer browser version of the social deduction board game.
Each player joins on their own device — phone, tablet, laptop. The server
holds the authoritative game state and reveals only what each player is
allowed to see (your role, your hand, your peek/investigation results).

![Secret Hitler online — gameplay](https://secret-hitler.com/assets/images/box.jpg)

## Features

- **5–10 player online multiplayer** over WebSockets (no polling, instant updates)
- **AI bots** to fill seats for solo testing or short-handed games — host can
  click *Add AI Player* in the lobby
- **Faithful to the official rules**: correct role distribution per player count,
  all four executive powers (Investigate, Peek, Special Election, Execution),
  veto power after 5 fascist policies, Hitler-as-Chancellor instant win at 3+
  fascist policies, term limits with the ≤5-alive special case, chaos policy on
  3 failed elections
- **Vote changes allowed until the final ballot** — matches the face-down ballot
  rule from the physical game
- **Live game history** in the right rail (latest round on top) plus a full
  modal timeline showing every nomination, vote, enacted policy, and power use
- **Themed art-deco UI** with stylized policy-card-back deck visuals, animated
  policy enactment, glowing role cards, and tooltips on the executive-power
  slots explaining what each does
- **Reconnect anywhere**: refresh the page, switch devices, or come back after
  the server restarts — your token rejoins your seat
- **Crash-resistant**: room state snapshots to disk on every change, restored
  on boot. Survives Render redeploys and free-tier sleep.
- **Mobile-first responsive layout**: portrait-orientation friendly, resilient
  on phones

## Quick start (local)

Requires Node.js 18+.

**Windows one-click:** double-click `start.bat`. Installs deps on first run,
auto-frees port 3000 if a previous run is still holding it, and starts.

**Manual:**

```bash
npm install
npm start
```

The server prints both `localhost` and LAN URLs. Same-Wi-Fi players can join
directly via the LAN URL.

## Deploy your own copy

The included [render.yaml](render.yaml) makes a one-click Render deployment:

1. Fork this repo
2. Go to [render.com](https://render.com) → **New + → Web Service** → connect your fork
3. Render auto-detects the config → click **Create Web Service**
4. ~90 seconds later you have your own public URL

Works equally well on Railway, Fly.io, or any host that runs Node and respects
`process.env.PORT`.

For temporary public access without deploying: `ngrok http 3000` after starting
the local server.

## How to play

1. The host opens the URL and clicks **Create Game** → gets a 4-letter room code
2. Other players open the URL, click **Join with Code**, enter the code + name
3. When 5–10 players are seated, the host clicks **Begin Game**
4. Each player privately sees their own role
5. Host clicks **Start First Round** and the game begins

[Official rules PDF](https://www.secrethitler.com/assets/Secret_Hitler_Rules.pdf) — but the in-game
*How to Play* button in the menu has the essentials.

## Project layout

```
.
├── server.js          Node WebSocket + static server, all game logic
├── bots.js            AI decision logic
├── package.json
├── render.yaml        Render.com deploy config
├── start.bat          Windows launcher (auto-frees port 3000)
└── public/
    ├── index.html     Welcome / lobby / game / end screens
    ├── styles.css     All styling
    └── client.js      Renders server state, sends actions
```

## Tech notes

- **Server**: Node 18+, single dependency (`ws`). Game state in memory plus a
  debounced JSON snapshot to `data/rooms.json` for crash recovery.
- **Client**: vanilla HTML/CSS/JS, no build step, no framework. Inline SVG
  icons, CSS-only tooltips, sticky right rail with internal scroll.
- **Architecture**: client receives state, never computes it; server validates
  every action; each player sees a filtered view (your role + public game state
  + private hands when active).
- **Animations**: pure CSS keyframes — card flip on role reveal, deck pulse on
  count change, history-row slide-in, policy-cell pop on enact.

## Credits & license

Game design © Mike Boxleiter, Tommy Maranges, Mac Schubert.
[Secret Hitler](https://www.secrethitler.com/) is licensed under
[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — this
implementation follows the same license. Non-commercial use only.

## Browser support

Tested on current Chrome, Edge, Firefox, and Safari (desktop and mobile).
