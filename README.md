# 🐺 Werewolf — Social Deduction Web Game

A real-time multiplayer Werewolf/Mafia game playable in a browser. Built with Node.js + TypeScript backend and static HTML/CSS/JS frontend, inspired by [OpenWerewolf](https://github.com/JamesCraster/OpenWerewolf).

## Stack

- **Frontend:** Static HTML/CSS/JS (deployed to GitHub Pages)
- **Backend:** Node.js + TypeScript + Express + Socket.io (deployed to Fly.io)
- **Architecture:** Game engine + pluggable roles and game modes

## Project Structure

```
/
├── backend/
│   ├── src/
│   │   ├── engine/
│   │   │   ├── gameManager.ts       # Game orchestration, state mutations
│   │   │   ├── phaseManager.ts      # Phase transitions (lobby → night → day)
│   │   │   └── winChecker.ts        # Win condition checking
│   │   ├── roles/
│   │   │   ├── villager.ts          # Basic villager role
│   │   │   ├── werewolf.ts          # Werewolf with night kill action
│   │   │   ├── seer.ts              # Seer with night investigation
│   │   │   └── doctor.ts            # Doctor with night protection
│   │   ├── gamemodes/
│   │   │   └── classic.ts           # Classic mode (5-20 players)
│   │   ├── server.ts                # Express + Socket.io entry point
│   │   └── types.ts                 # Shared interfaces
│   ├── package.json
│   ├── tsconfig.json
│   └── fly.toml                     # Fly.io deployment config
├── frontend/
│   ├── index.html                   # Lobby + game UI
│   ├── client.js                    # Socket.io client
│   └── style.css                    # Styles
└── .github/workflows/
    ├── deploy-frontend.yml          # Deploy to GitHub Pages
    └── deploy-backend.yml           # Deploy to Fly.io
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Development

1. **Install backend dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Start the dev server:**
   ```bash
   npm run dev
   ```
   Server runs on `http://localhost:3000`

3. **Open in browser:**
   - Open `http://localhost:3000` in multiple tabs
   - One tab: create a game (host)
   - Other tabs: join with the room code
   - Need at least 5 players to start

### Build & Production

```bash
cd backend
npm run build        # Compile TypeScript
npm start            # Run compiled server
```

## Game Flow

1. **Lobby** → Players join with room code
2. **Night** → Special roles perform actions (Werewolf kills, Seer investigates, etc.)
3. **Day** → All players discuss and vote to eliminate someone
4. **End** → Check win conditions; repeat until a team wins

### Win Conditions

- **Village wins:** All werewolves eliminated
- **Werewolves win:** Werewolves ≥ villagers, or all village eliminated

## Role System

Each role is a self-contained TypeScript file exporting a `Role` object:

```typescript
export const Villager: Role = {
  id: 'villager',
  name: 'Villager',
  team: 'village',
  description: 'A humble villager...',
  canVoteDuringDay: true,
  hasNightAction: false,
};
```

### Starter Roles

- **Villager** — No special powers
- **Werewolf** — Kills someone each night
- **Seer** — Investigates a player's role at night
- **Doctor** — Protects a player from death at night

### Adding New Roles

Create a file in `backend/src/roles/[role-name].ts` and import it in `backend/src/gamemodes/classic.ts`:

```typescript
import { YourRole } from '../roles/your-role';
// Then add to role list in getRoles()
```

No engine changes needed — roles are completely pluggable.

## Game Modes

Each game mode lives in `backend/src/gamemodes/[mode].ts` and exports a `GameMode` object that defines:

- Player count range
- Role composition based on player count
- Name & description

Modes are lazy-loaded per game; add a new mode without touching the engine.

## Socket.io Events

### Client → Server

```typescript
'lobby:create'    { playerName: string }
'lobby:join'      { roomCode: string; playerName: string }
'game:start'      —
'vote:cast'       { targetId: string }
'night:action'    { targetId: string }
```

### Server → Client

```typescript
'lobby:created'     { roomCode: string; playerId: string }
'lobby:joined'      { roomCode: string; playerId: string }
'lobby:updated'     { players: Array<{id, name}> }
'game:started'      { playerId: string; role: Role; players: Array }
'phase:changed'     { phase: GamePhase; secondsRemaining: number }
'game:ended'        { winner: PlayerTeam; winReason: string }
'error'             { message: string }
```

## Deployment

### GitHub Pages (Frontend)

- Push changes to `frontend/` → GitHub Actions auto-deploys to `gh-pages` branch
- Update `CNAME` in `deploy-frontend.yml` to your custom domain

### Fly.io (Backend)

- Push changes to `backend/` → GitHub Actions auto-deploys via `fly deploy`
- Requires `FLY_API_TOKEN` secret in GitHub (get from `flyctl auth token`)
- Update `app` name in `backend/fly.toml`

## TODO / Next Steps

- [ ] Night phase resolution loop (kill, protect, investigate logic)
- [ ] Day phase voting (tally votes, eliminate player, announce)
- [ ] Chat system per room
- [ ] Additional roles (Witch, Hunter, Sheriff, etc.)
- [ ] Game statistics & leaderboard
- [ ] Mobile-friendly UI polish
- [ ] Sound/toast notifications
- [ ] Reconnection handling
- [ ] Admin dashboard for server health

## Architecture Notes

- **Single game per room:** Each room code is a unique game instance; no cross-game state
- **In-memory only:** All state lives in `GameManager`'s `Map<roomCode, GameState>`; restarting server wipes games
- **No database:** Future: add persistence via Firebase RTDB or Postgres
- **Typed events:** Socket.io events are defined in `types.ts`; keep event names minimal

---

**License:** MIT  
**Inspired by:** [OpenWerewolf](https://github.com/JamesCraster/OpenWerewolf)
