# Velocity Arena

**Realtime multiplayer dogfight** — canvas ships, orb collection, Socket.IO authoritative server, and a full offline bot arena for GitHub Pages.

Live demo: **https://kianpk.github.io/velocity-arena/**

![stack](https://img.shields.io/badge/Vue_3-Canvas-42b883?style=flat-square)
![stack](https://img.shields.io/badge/Realtime-Socket.IO-010101?style=flat-square)
![stack](https://img.shields.io/badge/Node.js-Express-339933?style=flat-square)

## Why it stands out

- 60 Hz authoritative simulation on Node (not a toy clicker)
- Smooth canvas renderer: grid arena, glow orbs, hit shake, particle bursts
- CPU opponents so solo play still feels like a match
- Online mode via Socket.IO rooms; Pages build falls back to local sim
- WASD / arrows + Space fire, live leaderboard HUD

## Quick start

```bash
# Server
cd server && npm install && node index.js
# → :8790

# Client
cd client && npm install && npm run dev
# → :5174
```

Click **Play now** for local bots, or **Join online** when the server is running.

## Build Pages demo

```bash
cd client && npm run build
# → ../docs
```

## Author

[kianPk](https://github.com/kianPk)
