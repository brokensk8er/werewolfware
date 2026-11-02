# Werewolf Game — Project State Summary

**Last Updated:** September 19, 2026 (roadmap moved to `TODO.md`)  
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
- ✅ Mayor role (double vote, public title) and wolf-count scaling by player count (1/2/3/4 wolves)
- ✅ Ghost chat channel for dead players (`ghost:send`)
- ✅ Admin-driven single active game; bot players and night/vote simulation

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
- ✅ `fly.toml` — Fly.io config (`min_machines_running = 1`; auto-stop/auto-start enabled — keep exactly one machine)
- ✅ `.github/workflows/` — `deploy-frontend.yml` publishes Pages on `frontend/**` changes to `main`; `deploy-backend.yml` **deploys to Fly on `backend/**` changes to `main`** (or manually via `workflow_dispatch`). Docs-only changes trigger neither.
- ✅ `DEPLOYMENT.md` — Step-by-step setup guide
- N/A **Custom domain** — Not needed; players join via QR code

## What's TODO

**Canonical roadmap: [`TODO.md`](TODO.md)** (audit of 2026-11-01, runtime-verified). Use case: one in-person, moderator-run game per year (10–30 players), app as an aid; mothballed between uses (decision D1). Summary:

- **Pass 1 — Harden + safety net:** crash fixes (advance-from-lobby, payload-less events, late joins), payload validation, remove player-side host controls, action validation, wolf pack kill, day-vote ties, disconnect detection, rejoin token hardening, Vitest + smoke test.
- **Pass 2 — Extensibility refactor:** stable player id (not socket id), split `server.ts`, single role registry, night-action pipeline with role priorities, vote-weight/assign/death hooks, composable win conditions. Proof: add Hunter with zero engine edits.
- **Pass 3 — Party scale (10–30):** scaling table to 30, more roles, 30-bot load test.
- **Pass 4 — Ops & mothballing:** deploy hygiene, annual pre-event checklist (Node 18 is past end-of-life), LAN fallback, runbook.

### Known gaps (details and repro evidence in TODO.md)

- **Crashes (any one exits the server and loses the game):** `game:advancePhase` / Force Phase while in the lobby; an event with no payload; a late joiner (role `null`) hitting the game-end summary.
- Disconnects are never detected (the `disconnect` handler reads `socket.rooms`, already empty), so the disconnected indicator never shows. Rejoin itself works.
- Player-namespace `game:start` / `game:advancePhase` / `lobby:create` are unauthenticated (to be removed; the admin panel is the driver).
- No action validation: dead players' votes count, nonexistent vote targets are accepted, chat is unbounded and open to the dead.
- 3 wolves kill 3 players per night; vote ties go to the first-inserted target; `maxPlayers` is not enforced.
- Timers are display-only (by design under D1); the admin advances every phase.
- README's "no engine changes needed for new roles" is not yet true: night/day logic is hard-coded by role id.

### Won't Do

- **Leaderboard / game stats** — no persistent stats by design (state persistence for restarts is separate, see Pass 4)
- **Admin dashboard from scratch** — the admin panel already covers force-phase, role change, eliminate, kick
- **Sound notifications** — live show context; ambient sound in a full room would be chaos

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
