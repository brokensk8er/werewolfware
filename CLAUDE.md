# Werewolfware — Claude Instructions

## Git workflow

- Always commit and push directly to `main`.
- When there are multiple commits to push, squash them into a single commit first.
- Never push to a separate feature branch unless the user explicitly asks.
- Use `git push origin HEAD:main` to push.

---

## Project overview

Werewolfware is a real-time multiplayer Werewolf/Mafia party game playable in a browser.

- **Runtime:** Node.js (ES modules, `"type": "module"`)
- **Server framework:** Express 4 + Socket.io 4
- **Port:** 3000 (override with `PORT` env var)
- **Single-game constraint:** only one game can exist at a time; the game ID is hardcoded to `'GAME'` everywhere (see `createGame` in `src/gameManager.js` and all handlers in `src/socketHandlers.js`)
- **No database:** all state lives in-process in the `games` Map inside `gameManager.js`; restarts wipe state
- **No auth yet:** `authMiddleware` in `socketHandlers.js` is a stub that passes through without verification

---

## Development setup

```bash
npm install
npm run dev    # node --watch server.js (auto-restarts on file changes)
npm start      # production-style, no watch
```

Open `http://localhost:3000/admin` to create a game, then open `/join` in other tabs for players. Minimum 3 players required to start.

TODO: document any `.env` variables if added (currently none required beyond optional `PORT`).

---

## File structure

```
server.js                  — entry point; wires Express + Socket.io, registers roles at bootstrap
src/
  gameManager.js           — all game state + logic: createGame, joinGame, startGame,
                              castVote, setWerewolfTarget, advancePhase, snapshots
  socketHandlers.js        — all Socket.io event handlers; thin wrappers around gameManager
  phaseTimer.js            — PhaseTimer class: ticks every second, fires onExpire callback
  roles.js                 — LEGACY win-condition check (checkWinCondition); marked for
                              deletion once winChecker.js is wired in (migration step 4)
  engine/
    phaseEngine.js         — STUB: phase queue, advancement, timer wiring (step 5)
    roleRegistry.js        — IMPLEMENTED: register(), getRole(), assignRoles()
    actionRegistry.js      — STUB: register(), dispatch() (step 6)
    winChecker.js          — STUB: check(game, activeRoles) (step 4)
  roles/
    werewolf.js            — werewolf role definition (id, team, phases, actions,
                              hasWon, snapshotFor, countFor)
    villager.js            — villager role definition (isFiller: true, hasWon)
public/
  index.html               — landing page (links to /admin and /join)
  join.html + join.js      — player name entry; saves to sessionStorage, redirects to /player
  player.html + player.js  — main player UI (lobby, role reveal, day/night, chat)
  admin.html + admin.js    — game master UI (create, lobby, phase control, role grid)
  style.css                — all shared styles (dark theme)
docs/
  phase-engine-plan.md     — detailed refactor plan and role definition schema
```

---

## Architecture overview

### Request flow

```
Browser ──HTTP──▶ Express (static /public files)
        ──WS───▶ Socket.io ──▶ socketHandlers.js ──▶ gameManager.js (state mutations)
                                                  ──▶ engine/* (delegated as migration progresses)
```

### Socket.io room topology

Every connected socket joins `game:GAME:all`. Additional rooms:

| Room | Members |
|---|---|
| `game:GAME:main` | Living players (Town Square chat) |
| `game:GAME:dead` | Eliminated players (Beyond the Grave chat) |
| `game:GAME:werewolf` | Werewolves only (Wolf Den chat + night coordination) |
| `game:GAME:admin` | Admin tab only (full role-aware state) |

### Role system

Roles are plain JS objects conforming to the schema in `docs/phase-engine-plan.md`. Each role declares:

- `id`, `name`, `emoji`, `team`, `description`
- `countFor(totalPlayers)` → number of this role to assign
- `isFiller: true` → fills remaining slots after specials (villager uses this)
- `phases[]` → phase objects the role injects into the cycle
- `actions{}` → action definitions keyed by action ID
- `hasWon(game)` → boolean win condition for this role's team
- `snapshotFor(game, me)` → extra fields merged into a player's state snapshot

Roles are registered at bootstrap in `server.js` via `roleRegistry.register()`. Role assignment via `roleRegistry.assignRoles()` is already live as of step 3.

### Phase engine (target state — partially wired)

`src/engine/phaseEngine.js` will own a phase queue built by collecting `phases` from all active roles, sorting by `order`, and running them in sequence. `day` (order 0) is always first; role-injected phases follow (e.g. `night:werewolf` at order 200). See `docs/phase-engine-plan.md` for the full design.

---

## Socket event reference

**These event names are frozen** — clients depend on them. Do not rename without a coordinated client update.

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `game:create` | `{ hostName, dayDuration?, nightDuration? }` | Admin creates a game |
| `game:join` | `{ playerName }` | Player joins (or reconnects by name) |
| `game:start` | — | Admin starts the game (requires ≥3 players) |
| `game:advancePhase` | — | Admin skips current phase |
| `game:setTimers` | `{ dayDuration, nightDuration }` | Admin adjusts timers in lobby |
| `vote:cast` | `{ targetId }` | Player votes during day phase |
| `werewolf:target` | `{ targetId }` | Werewolf selects kill target at night |
| `chat:send` | `{ room, text }` | Send chat message (`main` / `dead` / `werewolf`) |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `game:created` | — | Confirms game creation to admin |
| `game:state` | full snapshot | Full state on join/reconnect |
| `game:started` | `{ role, phase, phaseEndsAt }` | Game started; delivers player their role |
| `lobby:updated` | `{ players[] }` | Player list changed in lobby |
| `phase:changed` | `{ phase, phaseEndsAt }` | Phase transition |
| `phase:tick` | `{ secondsRemaining }` | Countdown tick (1 s interval) |
| `vote:updated` | `{ votes[] }` | Live vote tally update |
| `vote:result` | `{ eliminated, reason }` | End-of-day vote outcome |
| `night:result` | `{ eliminated, reason }` | End-of-night kill outcome |
| `player:eliminated` | `{ playerName, playerId, wasWerewolf, cause }` | Player eliminated |
| `player:lateJoin` | `{ playerName, role }` | Player joined a game in progress |
| `werewolf:targetSelected` | `{ byName, targetId, targetName }` | Wolf target broadcast to Wolf Den |
| `chat:message` | message object | New chat message |
| `admin:state` | full admin snapshot | Admin-only full state with all roles |
| `game:ended` | `{ winner, roles[] }` | Game over |
| `error` | `{ code, message }` | Error response |

TODO: add `action:perform` event once actionRegistry is wired (migration step 6).

---

## Refactor status

Current position: **between step 3 and step 4** of the 9-step migration in `docs/phase-engine-plan.md`.

- [x] Step 1 — Engine skeleton added (`phaseEngine.js`, `roleRegistry.js`, `actionRegistry.js`, `winChecker.js` stubs)
- [x] Step 2 — Role files created (`src/roles/werewolf.js`, `src/roles/villager.js`) and registered in `server.js`
- [x] Step 3 — Role assignment switched to `roleRegistry.assignRoles()` in `gameManager.startGame()`
- [ ] Step 4 — Wire win checking: `gameManager.advancePhase()` calls `winChecker.check()` instead of legacy `roles.checkWinCondition()`
- [ ] Step 5 — Replace `advancePhase()` with `phaseEngine.advance()`
- [ ] Step 6 — Wire actions through `actionRegistry`; add `action:perform` socket event
- [ ] Step 7 — Update `getStateSnapshot` to call `role.snapshotFor()`
- [ ] Step 8 — Delete `src/roles.js`
- [ ] Step 9 — Verify full game flow end-to-end

---

## Out of scope

- Adding new roles (Seer, Witch, Hunter, Sheriff) — the phase-engine refactor is designed to make these drop-in additions
- Firebase Auth — `authMiddleware` stub in `socketHandlers.js` is the hook point
- Persistence (Firebase RTDB or similar) — all state is currently in-memory
- Multiple simultaneous games — single-game constraint (`id: 'GAME'`) is intentional for now
- Per-role chat rooms beyond the existing three (Wolf Den, Town Square, Beyond the Grave)
- Mobile-native app
