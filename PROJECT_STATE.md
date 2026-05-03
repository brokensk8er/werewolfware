# Werewolf Game — Project State Summary

**Last Updated:** May 3, 2026  
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

### Frontend (HTML/CSS/JS)
- ✅ Lobby: create/join game by room code
- ✅ Game UI: role reveal, phase display, timer
- ✅ Night phase: target selection for special roles
- ✅ Day phase: vote on players (live tally)
- ✅ Chat: real-time messages, XSS protected
- ✅ Mobile-friendly grid layout
- ✅ Error/notification toasts

### Deployment Config
- ✅ `fly.toml` — Fly.io setup (256MB VM, auto-scaling disabled)
- ✅ `.github/workflows/deploy-backend.yml` — Deploy on backend changes
- ✅ `.github/workflows/deploy-frontend.yml` — Deploy to GitHub Pages
- ✅ `DEPLOYMENT.md` — Step-by-step setup guide

## What's TODO ❌

### High Priority (MVP completion)
- ⚠️ **Fly.io deployment** — Need API token, configure GitHub secret, `flyctl launch`
- ⚠️ **GitHub Pages domain** — Configure in repo settings, custom domain (optional)

### Medium Priority (Post-MVP)
- Reconnection handling (player DC/rejoin) — ~3-5k tokens
- Additional roles (Witch, Hunter, Sheriff) — ~2-3k each
- Game statistics & leaderboard
- Admin dashboard (force phase advance, manage players)

### Low Priority (Polish)
- Mobile UI edge cases (landscape mode, small screens)
- Sound/toast notifications
- Dead player chat room
- Role balance per player count
- Phase timer configuration

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
- [ ] Fly.io account created
- [ ] `flyctl` CLI installed
- [ ] `FLY_API_TOKEN` added to GitHub secrets
- [ ] Backend deployed to Fly.io
- [ ] Frontend deployed to GitHub Pages
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
