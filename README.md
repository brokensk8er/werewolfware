# Werewolfware

Real-time multiplayer Werewolf/Mafia party game for the browser.

## Stack

- **Node.js** (ES modules) + **Express 4** + **Socket.io 4**
- Vanilla HTML/CSS/JS frontend — no build step
- In-memory state — no database

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| URL | Who |
|---|---|
| `/admin` | Host — create a game and control phases |
| `/join` | Players — enter a name and join |

Minimum **3 players** required to start. Override the default port with a `PORT` environment variable.

## Gameplay

1. Host creates a game and sets day/night timer durations.
2. Players join from `/join`. Host starts the game when ready.
3. Each player is secretly assigned a role (Werewolf or Villager).
4. **Day phase** — all living players discuss and vote to eliminate a suspect. Majority required; ties spare everyone.
5. **Night phase** — werewolves privately agree on a kill target (Wolf Den chat).
6. Phases repeat until a team wins.

**Villagers win** when all werewolves are eliminated.  
**Werewolves win** when their count equals or exceeds the remaining villagers.

## Roles

| Role | Team | Count |
|---|---|---|
| Werewolf 🐺 | Werewolves | ~1 per 3 players |
| Villager 👤 | Villagers | fills remaining slots |

## Chat rooms

| Room | Access |
|---|---|
| Town Square | All living players |
| Wolf Den | Werewolves only |
| Beyond the Grave | Eliminated players only |

## Project layout

```
server.js           — Express + Socket.io entry point
src/
  gameManager.js    — game state and logic
  socketHandlers.js — Socket.io event handlers
  phaseTimer.js     — countdown timer
  engine/           — pluggable phase/role/action engine (in progress)
  roles/            — role definitions (werewolf, villager)
public/             — frontend pages and scripts
docs/               — architecture and refactor plans
```

## Development

```bash
npm run dev    # node --watch — auto-restarts on file changes
npm start      # no watch
```

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start server |
| `npm run dev` | Start with file watching |
