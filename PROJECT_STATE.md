# Werewolf Game — Project State Summary

**Last Updated:** November 18, 2026 (Pass A2 merged; roadmap in `TODO.md`)
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
- ✅ `fly.toml` — Fly.io config (`min_machines_running = 1`; auto-stop/auto-start enabled — keep exactly one machine). Node 24.
- ✅ `.github/workflows/` — `check.yml` type-checks and runs `tests/phone-check`. `deploy-frontend.yml` publishes Pages on `frontend/**` changes to `main`; `deploy-backend.yml` **deploys to Fly on `backend/**` changes to `main`**. Both run `check.yml` first and deploy only if it passes. Docs-only changes trigger neither.
- ✅ `DEPLOYMENT.md` — Step-by-step setup guide
- N/A **Custom domain** — Not needed; players join via QR code

## What's TODO

**Canonical roadmap: [`TODO.md`](TODO.md)** (audit of 2026-11-13; Pass A merged 2026-11-15, Pass A2 on 2026-11-18). Use case: one in-person, moderator-run game per year (10–30 players), app as an aid; mothballed between uses (decision D1). Summary:

- **Pass A — Night-stoppers:** done 2026-11-15.
- **Pass A2 — Rule fixes and deploy gate:** done 2026-11-18.
- **Pass B — One snapshot per phone:** the server sends each player their whole view; stable player id.
- **Pass C — Player phone:** new screens, one job per phase, role hidden until held.
- **Pass D — Moderator panel:** role setup, result preview, player sheet, bring-back and undo.
- **Pass E — Rules and roles:** night-action pipeline, Hunter, more roles, engine unit tests.
- **Pass F — Before the event:** Fly-only hosting, load script, real-phone rehearsal, runbook.

### Fixed on 2026-11-15 (Pass A)

Host buttons on player phones, phones that drop and reconnect, the moderator list on phones, Advance Phase in the lobby, events with no payload, late joiners, mid-game removal, the end screen, invisible moderator errors.

### Fixed on 2026-11-18 (Pass A2)

One werewolf kill per night; vote ties eliminate nobody; every vote and night choice is checked; chat limits; votes hidden from phones; the Seer learns the team only; about one werewolf per six players with a 30-player cap; Eliminate checks for a win; End Game no longer announces a village win; Mayor in Change Role; the moderator log is kept at game end; Node 24. Every deploy now waits for `check.yml` (type check plus `tests/phone-check`: 38 rule checks, 49 phone-size checks).

### Decisions (2026-11-16, details in TODO.md)

In-person, moderator-run (D1). Only roles with a night action choose; everyone else sees a waiting screen; day and night have their own colour themes (D5). Werewolves see their pack on the held role card (D6). Town chat is replaced by private notes; ghost chat stays (D7). Votes hidden until voting closes (D8). Seer learns the team (D9). About one werewolf per six players (D10). Google sign-in only (D11). Fly only, no GitHub Pages (D12).

### Known gaps (details in TODO.md and the design proposal)

- Change Role mid-game leaves the phone's night screen stale until the phase changes.
- A page refresh loses private results (seer findings). Roles show as a dash after a moderator reload.
- The player screens are still a desktop layout on a phone: long scrolling pages, role always visible, low contrast. The redesign is passes B–D.
- Player ids are still socket ids, so every reconnect changes them. The pages cope; a stable id is Pass B.
- Pages still load from GitHub Pages and the socket.io CDN until Fly-only hosting (D12) lands.
- Timers are display-only (by design under D1); the moderator advances every phase.
- README's "no engine changes needed for new roles" is not yet true: night/day logic is hard-coded by role id.
- Not yet tested on real phones.

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
