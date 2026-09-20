# Werewolf Game — Project State Summary

**Last Updated:** September 20, 2026
**Current Branch:** `main`

## What's Done ✅

### Backend (Node.js + TypeScript)
- ✅ Express + Socket.io server on port 3000
- ✅ Game engine: phases (night/day), voting, win conditions
- ✅ 5 roles: Villager, Werewolf, Seer, Doctor, Mayor (2x vote weight, name publicly tagged)
- ✅ Night phase resolution: kills, protections, investigations
- ✅ Day phase voting: vote tally (Mayor counts double), elimination
- ✅ Real-time chat system (town square) + separate ghost-only chat channel for eliminated players
- ✅ Type-safe Socket.io events (TypeScript interfaces)
- ✅ Game state in-memory (Map<roomCode, GameState>)
- ✅ Mid-game reconnection — token-based rejoin, full state restore, disconnected indicator in player list
- ✅ Admin namespace (`/admin`): Firebase-authenticated moderator controls — create/end game, force phase, change role, eliminate/kick, rename, cast vote or submit night action on behalf of any player, randomize remaining actions (solo testing), set custom phase timer
- ✅ Admin log (per-category event feed) — cleared automatically on game end

### Frontend (HTML/CSS/JS)
- ✅ Lobby: join active game by name (no room code shown to players)
- ✅ Game UI: role reveal, phase display, timer
- ✅ Night phase: target selection for special roles
- ✅ Day phase: vote on players (live tally)
- ✅ Chat: real-time messages, XSS protected
- ✅ Death notification overlay + ghost screen (dead-only chat, alive/dead roster) for eliminated players
- ✅ End-game results screen — every player's role, team, and fate
- ✅ Mobile-friendly grid layout
- ✅ Error/notification toasts
- ✅ Admin panel (`admin.html`/`admin.js`): Google Sign-In auth, full simulation controls (add/remove players, force phase, change role, vote/night-action on behalf of a player, randomize remaining actions, filterable event log)

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
2. **Mobile polish** — Landscape mode and screens <375px have layout issues in the vote/target card grid
3. **One-time Firebase console setup** — see `FIREBASE_SETUP_TODO.md`; a manual checklist (enable Google sign-in provider, set `isAdmin: true` on the moderator's Firestore doc), not a code change. Confirm it's still complete if admin login ever starts failing.

### Admin panel (from `HANDOFF.md` session notes)

- **Event log refinements** — no "clear" button, no scroll-to-top, no search/filter by player name; a phase separator row (e.g. `── Night 2 ──`) injected on each `admin:phaseUpdate` would make long sessions easier to read.
- **`admin:castVote` doesn't fire player-facing vote notifications** (ambiguous town chat + private confirmation) — only the player-side `vote:cast` handler does. Fix: extract the notification logic into a shared helper used by both handlers.
- **No lobby reset without a full end→create cycle.** Once a game is ended, the admin must create a new one from scratch.
- **`admin:startGame`'s min-player-count error hardcodes `5`** instead of reading `game.gameMode.minPlayers` — will drift if a mode with a different minimum is ever added.
- **`admin:submitNightAction` has no "already submitted" guard** — calling it twice for the same actor silently overwrites the previous action. Fine for simulation, worth knowing.

### Known gaps (server doesn't enforce what the UI already does)

- **Dead players can still cast a day vote.** The `vote:cast` handler and `GameManager.resolveDay()` never check `voter.alive`; a client that bypasses the (dead-player-hidden) UI could still vote. Not yet fixed — flagged as a correctness/security item to pick up separately.
- **Night-action target list doesn't filter out dead players** in `client.js`'s `renderTargetList()` (unlike `renderVoteList()`, which does) — targeting an eliminated player wastes a night action. Not yet fixed.
- **Role shuffle uses `Array.sort(() => Math.random() - 0.5)`** in `classic.ts`, a known non-uniform shuffle; a Fisher-Yates shuffle would give truly fair role assignment. Not yet fixed.
- **Werewolves aren't blocked from targeting themselves** at night (the admin `randomizeActions` simulator explicitly avoids this, implying it was intended for real play too). Not yet fixed.
- **Missing input validation** on admin `renamePlayer`/`addPlayer` (`.trim()` on a possibly-missing field) and on `chat:send`/`ghost:send`/`lobby:join` text — a malformed payload can throw and crash the process, or store non-string/oversized data. Not yet fixed.

### Low Priority (inline stubs, not blockers)

- `server.ts` — `game:setMode` handler is a stub; mode switching in lobby unimplemented (only ClassicMode exists)
- `DEPLOYMENT.md:144` — CORS is `origin: '*'`; tighten to your domain before any public/open-access show
- Rejoin tokens (`Math.random()`-based) aren't cryptographically random, and the `rejoinTokens` map is never pruned (small, unbounded memory leak over the process lifetime). Low severity for a single in-memory party game, but worth a CSPRNG + cleanup pass if this ever runs long-lived or public-facing.

### Won't Do

- **Leaderboard / game stats** — No persistent storage; in-memory only by design
- **Admin dashboard from scratch** — Admin panel already covers force-phase, role change, eliminate, kick; full dashboard is overkill
- **Sound/toast notifications** — Live show context; ambient sound in a full room would be chaos

## Architecture Overview

```
werewolfware/
├── Dockerfile                      — Fly.io build (used by `flyctl deploy` from repo root)
├── fly.toml                        — Fly.io config
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
│   │   │   ├── doctor.ts
│   │   │   └── mayor.ts
│   │   ├── gamemodes/
│   │   │   └── classic.ts          — 5-20 players, wolf count scaled by player count
│   │   ├── server.ts               — Express + Socket.io (player + /admin namespaces)
│   │   └── types.ts                — Shared interfaces
│   ├── package.json
│   ├── tsconfig.json
│   └── dist/                       — Compiled JS (gitignored)
├── frontend/
│   ├── index.html                  — Player lobby + game UI
│   ├── client.js                   — Player Socket.io client
│   ├── login.html                  — Admin Google Sign-In
│   ├── admin.html / admin.js / admin.css — Moderator dashboard
│   └── style.css                   — Responsive styles
├── .github/workflows/
│   ├── deploy-backend.yml
│   └── deploy-frontend.yml
├── README.md                       — Architecture & dev guide
├── DEPLOYMENT.md                   — Fly.io setup steps
├── FIREBASE_SETUP_TODO.md          — One-time Firebase console checklist for admin auth
├── HANDOFF.md                      — Admin panel implementation notes
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
- Default durations: `server.ts`/`gameManager.ts` fall back to `game.customPhaseDuration ?? 30` seconds wherever a phase timer is set
- Per-room override: admin `setTimer` (sets `customPhaseDuration`, which persists across phase advances)

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
