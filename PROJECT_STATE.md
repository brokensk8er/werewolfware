# Werewolf Game — Project State Summary

**Last Updated:** May 4, 2026  
**Current Branch:** `main`

## What's Done ✅

### Backend (Node.js + TypeScript)
- ✅ Express + Socket.io server on port 3000
- ✅ Game engine: phases (night/day), voting, win conditions
- ✅ 4 starter roles: Villager, Werewolf, Seer, Doctor
- ✅ Night phase resolution: kills, protections, investigations
- ✅ Day phase voting: vote tally, elimination
- ✅ Real-time chat system (town square)
- ✅ Type-safe Socket.io events (TypeScript interfaces)
- ✅ Game state in-memory (Map<roomCode, GameState>)
- ✅ Mid-game reconnection — token-based rejoin, full state restore, disconnected indicator in player list

### Frontend (HTML/CSS/JS)
- ✅ Lobby: join active game by name (no room code shown to players)
- ✅ Game UI: role reveal, phase display, timer
- ✅ Night phase: target selection for special roles
- ✅ Day phase: vote on players (live tally)
- ✅ Chat: real-time messages, XSS protected
- ✅ Mobile-friendly grid layout
- ✅ Error/notification toasts
- ✅ Admin panel: Google Sign-In auth, full simulation controls (add/remove players, force phase, change role, vote on behalf of player)

### Deployment
- ✅ **Backend live** — `https://werewolfware.fly.dev` (Fly.io, 256MB VM)
- ✅ **Frontend live** — GitHub Pages (`brokensk8er.github.io/werewolfware`)
- ✅ `fly.toml` — Fly.io config (auto-scaling disabled)
- ✅ `.github/workflows/` — GitHub Actions for Pages deploy on push to `main`
- ✅ `DEPLOYMENT.md` — Step-by-step setup guide
- N/A **Custom domain** — Not needed; players join via QR code

## What's TODO

### Post-MVP (prioritized)

1. **Additional roles** — Witch (poison/save), Hunter (takes someone on death), Sheriff (visible investigation)
   - Each is ~2-3k tokens: new file in `backend/src/roles/` + entry in `classic.ts`
2. **Role balance by player count** — `classic.ts getRoles()` always assigns 1 wolf regardless of count
   - Needs a lookup table (5-7 players: 1 wolf, 8-10: 2 wolves, etc.)
   - See TODO comment in `backend/src/gamemodes/classic.ts:14`
3. **Dead player chat** — Dead players can still type in the main chat; needs mute-on-death or a separate dead-only channel
4. **Mobile polish** — Landscape mode and screens <375px have layout issues in the vote/target card grid

### Low Priority (inline stubs, not blockers)

- `server.ts:336` — `game:setMode` handler is a stub; mode switching in lobby unimplemented (only ClassicMode exists)
- `phaseManager.ts:20` — Phase durations hardcoded 30s/60s; admin `setTimer` already overrides per-room so not a blocker
- `DEPLOYMENT.md:144` — CORS is `origin: '*'`; tighten to your domain before any public/open-access show

### Won't Do

- **Leaderboard / game stats** — No persistent storage; in-memory only by design
- **Admin dashboard from scratch** — Admin panel already covers force-phase, role change, eliminate, kick; full dashboard is overkill
- **Sound/toast notifications** — Live show context; ambient sound in a full room would be chaos

## Architecture Overview

```
werewolfware/
├── backend/
│   ├── src/
│   │   ├── engine/
│   │   │   ├── gameManager.ts      — Main orchestration
│   │   │   ├── phaseManager.ts     — Phase transitions
│   │   │   └── winChecker.ts       — Win conditions
│   │   ├── roles/
│   │   │   ├── villager.ts
│   │   │   ├── werewolf.ts
│   │   │   ├── seer.ts
│   │   │   └── doctor.ts
│   │   ├── gamemodes/
│   │   │   └── classic.ts          — 5-20 players, balanced roles
│   │   ├── server.ts               — Express + Socket.io
│   │   └── types.ts                — Shared interfaces
│   ├── package.json
│   ├── tsconfig.json
│   ├── fly.toml                    — Fly.io config
│   └── dist/                       — Compiled JS (gitignored)
├── frontend/
│   ├── index.html                  — Single-page UI
│   ├── client.js                   — Socket.io client
│   └── style.css                   — Responsive styles
├── .github/workflows/
│   ├── deploy-backend.yml
│   └── deploy-frontend.yml
├── README.md                       — Architecture & dev guide
├── DEPLOYMENT.md                   — Fly.io setup steps
└── PROJECT_STATE.md                — This file

```

## How to Run Locally

```bash
# Install + build
cd backend
npm install
npm run build

# Start server (port 3000)
npm start

# Open http://localhost:3000 in browser (or multiple tabs to test)
```

## Game Flow (Current)

1. **Lobby:** Players create/join with room code
2. **Role Assignment:** Host clicks "Start Game" → roles shuffled
3. **Night Phase (30s):** 
   - Werewolves select kill target
   - Seer selects investigation target
   - Doctor selects protection target
   - Host clicks "Advance Phase"
   - → Results: eliminations announced, seer gets role reveal
4. **Day Phase (60s):**
   - All players vote to eliminate someone
   - Vote tally updates in real-time
   - Host clicks "Advance Phase"
   - → Results: player eliminated, death announced
5. **Win Check:** After each phase, check if village or werewolves won
6. **Repeat** or **End Game** with winner announcement

## Key Decisions Made

| Decision | Rationale |
|----------|-----------|
| In-memory game state | Simple, no DB latency; fine for MVP |
| ES modules | Modern, fast import paths; no CommonJS baggage |
| Type-safe Socket.io | Catch event mismatches at compile time |
| Pluggable roles | Add new roles without touching engine |
| 30s night / 60s day | Aggressive pacing for testing; configurable later |
| GitHub Pages for frontend | Free, simple, no backend needed for static files |
| Fly.io for backend | Free tier, Socket.io-friendly, auto-scaling optional |

## Common Tasks

### Add a New Role
1. Create `backend/src/roles/[name].ts`
2. Export `Role` object with properties: `id`, `name`, `team`, `description`, `hasNightAction`
3. Import in `backend/src/gamemodes/classic.ts`
4. Add to `getRoles()` array based on player count
5. Rebuild: `npm run build`

### Change Game Timing
- Edit `backend/src/engine/phaseManager.ts` → `getPhaseDuration()`
- Or `backend/src/server.ts` → `phaseEndsAt = Date.now() + <ms>`

### Test Phase Advancement Without Timer
- Host clicks "Advance Phase" button (manual)
- Can speed up testing by lowering durations

## Git Workflow

- Main branch: `main` (auto-deploys via GitHub Actions)
- All changes commit directly to `main`
- Squash commits before pushing if cleaning up

## Deployment Checklist

Before going live, see `DEPLOYMENT.md` for:
- [x] Fly.io account created
- [x] `flyctl` CLI installed
- [x] `FLY_API_TOKEN` added to GitHub secrets
- [x] Backend deployed to Fly.io
- [x] Frontend deployed to GitHub Pages
- [ ] CORS updated to your domain
- [ ] Firewall rules checked

## Debugging Tips

| Issue | Solution |
|-------|----------|
| TypeScript errors | `npm run build` in backend folder |
| Server won't start | Check `npm start` output; node version (need 18+) |
| Socket.io not connecting | Check browser console; CORS origin mismatch |
| Vote/chat not working | Check Socket.io event names in types.ts |
| Frontend not updating | Hard refresh (Cmd+Shift+R), clear cache |
| Game stuck in phase | Host click "Advance Phase" manually |

## Next Session Brief

If picking up development:
1. Read this file to understand current state
2. See `DEPLOYMENT.md` to set up Fly.io
3. See `README.md` for role/mode architecture
4. See `backend/src/types.ts` for Socket.io event contracts

---

**Questions?** Check README.md (architecture), DEPLOYMENT.md (setup), or inline TODOs in code.
