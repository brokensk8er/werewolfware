# Werewolfware — Admin Panel Handoff

This document is a context dump for continuing work on the admin panel in a new chat session.

---

## Session 2 — Admin Simulation + Event Log (2026-05-04)

### What Was Built

The admin panel can now run a complete game without any real players. The full set of new socket events added this session:

**Backend (`server.ts`) — new admin events:**
- `admin:startGame` — starts the game from admin; handles role assignment and emits `game:started` to real (non-bot) sockets only
- `admin:endGame` — tears down the active game, resets all admin watcher state, emits `admin:noGame` to all watching admin sockets
- `admin:addPlayer` — adds a virtual bot player (ID prefixed `bot_`) to the lobby; bot players are skipped on socket emits throughout the server
- `admin:removePlayer` — removes any player (bot or real) from lobby or mid-game; disconnects real player sockets
- `admin:renamePlayer` — renames any player; `gameManager.renamePlayer()` was added for this
- `admin:castVote` — submits a day vote on behalf of any player (admin simulation)
- `admin:submitNightAction` — submits a night action (werewolf kill, seer investigate, doctor protect) on behalf of any player

**Frontend (`admin.html` / `admin.js`):**
- Lobby Controls panel (visible only in lobby phase): Add Player input, Start Game button with live readiness hint (min 5 players enforced)
- End Game button in Phase Controls with confirm dialog
- Timer input changed from seconds to minutes (floats allowed, e.g. 1.5; multiplied ×60 before sending)
- Player modal is now context-aware: shows Rename, Change Role always; Submit Night Action (night phase + player has night action role); Cast Vote (day phase); Remove from Lobby / Force Eliminate / Kick based on phase

**Vote notification system:**
- Town-wide: ambiguous flavour text sent directly via `io.to(roomCode).emit('chat:message')` — bypasses `announce()` so it does NOT appear in the admin log
- Admin log: clear `voter.name → Voted for target.name` entry pushed separately
- Voter private: confirmation with target name + sardonic sign-off via `announcePrivate`

### Common Points of Failure

**1. `announce()` logs to admin — don't use it for player-only messages.**
`announce()` calls both `io.to(roomCode).emit` AND `gameManager.pushAdminLog` + `emitToAdmins`. If you want a message that only players see (ambiguous flavour text, misdirection), emit `chat:message` directly to the room instead. The vote ambiguity fix this session was exactly this bug.

**2. Bot player IDs must be checked before any `io.to(playerId).emit` call.**
Bot players have no real socket. Any `io.to(botId).emit(...)` silently no-ops, which is fine — but if you ever iterate players and try to do something socket-specific (e.g. `io.sockets.sockets.get(playerId)`), always guard with `if (!playerId.startsWith('bot_'))`. The `admin:startGame` and `admin:removePlayer` handlers both do this.

**3. Admin watcher cleanup on `admin:endGame`.**
After ending a game, each watching admin socket's `socket.data.roomCode` must be cleared manually — otherwise the next `admin:createGame` call from that socket will think it's already in a room. The `admin:endGame` handler iterates `adminWatchers` and nulls `s.data.roomCode` before deleting the game.

**4. `LogCategory` type in `types.ts`.**
The valid categories are: `'town' | 'werewolf' | 'seer' | 'private' | 'system' | 'chat'`. The admin log filter buttons in the UI cover: All, System, Chat, Seer, Werewolf, Private. `town` exists as a category but has no dedicated filter button — Town entries are visible under "All" only. If you add new log categories, add a matching filter button in `admin.html` and a matching entry in the `CAT_LABELS` map in `admin.js`.

**5. `flyctl deploy` is required for any backend change.**
Frontend pushes to `main` auto-deploy via GitHub Actions to GitHub Pages. Backend changes do nothing until `flyctl deploy` is run manually from the repo root. `fly` is not the right binary name on this machine — use `flyctl`.

### What's Left / Next Work

- **Event log refinements:** The log has no "clear" button, no scroll-to-top, no search/filter by player name. Entries stack up across the whole session with no way to segment by round/phase. A phase separator row (e.g. `── Night 2 ──`) injected on each `admin:phaseUpdate` would make the log much easier to read.
- **Admin `admin:castVote` does not fire the vote notification messages** (ambiguous town chat + private confirmation). Only the player-side `vote:cast` handler does. If simulating votes via admin, players won't see the pebble-in-jar message. Fix: extract vote notification logic into a shared helper and call it from both handlers.
- **No "clear game" / lobby reset without ending.** Once a game is ended, the admin must create a new one. There's no way to reset the lobby back to zero without the full end→create cycle.
- **Min player count (5) is hardcoded from `ClassicMode.minPlayers`.** The `admin:startGame` handler currently hardcodes `5` in its error string rather than reading from the game mode. Should use `game.gameMode.minPlayers` for correctness if modes are ever added.
- **Night action submission from admin has no "already submitted" guard.** Calling `admin:submitNightAction` twice for the same actor overwrites the previous action silently. That's probably fine for simulation but worth noting.


---

## What This Project Is

A real-time social deduction (Werewolf) game. Backend is Express + Socket.io on **Fly.io** (`https://werewolfware.fly.dev`). Frontend is static files on **GitHub Pages** (`brokensk8er.github.io/werewolfware`). One game runs at a time — no room codes anywhere in the UI.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + TypeScript, Express, Socket.io, Firebase Admin SDK |
| Frontend | Vanilla JS (ES modules), Socket.io client, Firebase JS SDK v10 |
| Auth | Firebase Authentication (Google Sign-In) + Firestore `isAdmin` flag |
| Hosting | Fly.io (backend), GitHub Pages (frontend) |
| Firebase project | `nodicetools` (shared with another project — nodicetools.firebaseapp.com) |

---

## Auth Flow

1. Player navigates to `login.html` → clicks "Sign in with Google" → `signInWithPopup`
2. After sign-in, frontend checks Firestore `users/{uid}.isAdmin === true`
3. If true → redirect to `admin.html`; if false → sign out and show error
4. `admin.html` on load → `onAuthStateChanged` re-checks `isAdmin`, then calls `connectToGame(user)`
5. `connectToGame` opens a Socket.io connection to `https://werewolfware.fly.dev/admin`
6. On connect, emits `admin:auth` with a Firebase ID token (no room code)
7. Backend (`server.ts`) calls `verifyAdminToken(token)` — verifies via Firebase Admin SDK, then checks Firestore `users/{uid}.isAdmin === true`
8. If verified → auto-attaches admin to the single active game (or emits `admin:noGame` if none exists)

**Admin account:** `stopdavidlane@gmail.com` — must have `isAdmin: true` in Firestore `users/{uid}` doc.

---

## Critical Backend Environment Variable

The backend requires `FIREBASE_SERVICE_ACCOUNT` set as a Fly.io secret. This is the full JSON content of the Firebase service account key file (downloaded from Firebase Console → Project Settings → Service accounts → Generate new private key).

**Without this, every admin token verification returns "Unauthorized" silently.** The frontend error goes to a hidden element so there's no visible feedback — this was a painful debug session. If admin.html shows the header (email + Sign out) but nothing else, this is the first thing to check.

To verify it's set: `fly secrets list` (requires fly CLI installed).
To set it: `Get-Content "path\to\key.json" -Raw | fly secrets set FIREBASE_SERVICE_ACCOUNT=-` (PowerShell).

---

## Key Files

```
backend/
  src/
    server.ts          — Main Express + Socket.io server. All socket events here.
    engine/
      gameManager.ts   — Game state CRUD. getActiveRoomCode() returns the single active game.
      phaseManager.ts  — Phase transition logic
      winChecker.ts    — Win condition evaluation
    roles/             — Villager, Werewolf, Seer, Doctor
    gamemodes/
      classic.ts       — Role mix for Classic mode
    types.ts           — All TypeScript types and Socket.io event definitions

frontend/
  index.html           — Player landing page (name input only, no room code)
  client.js            — Player socket client
  login.html           — Google Sign-In only (no email/password)
  admin.html           — Admin dashboard shell
  admin.js             — Admin socket client (ES module)
  admin.css            — Admin dashboard styles
```

---

## Socket.io Event Reference

### Player namespace (`/`)
| Event (client → server) | Payload | Description |
|---|---|---|
| `lobby:join` | `{ playerName }` | Join active game (no room code needed) |
| `game:start` | — | Start the game (host only) |
| `game:advancePhase` | — | Manual phase advance (host) |
| `chat:send` | `{ text }` | Send chat message |
| `game:vote` | `{ targetId }` | Day vote |
| `game:nightAction` | `{ targetId }` | Night action |

### Admin namespace (`/admin`)
| Event (client → server) | Payload | Description |
|---|---|---|
| `admin:auth` | `{ token }` | Authenticate with Firebase ID token |
| `admin:createGame` | — | Create a new game (only when none active) |
| `admin:forcePhase` | — | Force advance current phase |
| `admin:changeRole` | `{ playerId, roleId }` | Change player role mid-game |
| `admin:eliminate` | `{ playerId }` | Force-eliminate a player |
| `admin:kick` | `{ playerId }` | Remove player from game entirely |
| `admin:setTimer` | `{ seconds }` | Set custom phase duration |

| Event (server → admin client) | Payload | Description |
|---|---|---|
| `admin:authed` | `{ uid, roomCode? }` | Auth confirmed |
| `admin:noGame` | — | No active game exists |
| `admin:state` | `{ players, phase, secondsRemaining, votes, log }` | Full game snapshot |
| `admin:playerUpdate` | `{ players }` | Player list changed |
| `admin:phaseUpdate` | `{ phase, secondsRemaining }` | Phase/timer changed |
| `admin:voteUpdate` | `{ votes }` | Vote tally changed |
| `admin:logEntry` | `{ category, senderName, text, meta, timestamp }` | New log entry |

---

## Single-Game Architecture

There is no room code in any UI. `GameManager.getActiveRoomCode()` returns the first key from the `games` Map — since only one game runs at a time, this is always the right one.

- Admin creates a game via the "Create Game" button → `admin:createGame` → backend generates a room code internally and stores it in `gameManager.games`
- Players go to `index.html`, enter name, hit Join → `lobby:join` with just `{ playerName }` → backend auto-resolves the active room
- Room code is server-side only and never shown anywhere

---

## Deployment

**Frontend:** Push to `main` → GitHub Actions deploys to GitHub Pages automatically (`.github/workflows/`).

**Backend:** Push to `main` triggers nothing for Fly.io — backend must be deployed manually:
```
fly deploy
```
from the repo root (requires fly CLI and being logged in).

**Git workflow:** Always commit directly to `main` and push immediately. No branches.

---

## Known Gotchas

1. **`FIREBASE_SERVICE_ACCOUNT` missing = silent auth failure.** The error event from the backend lands in `#picker-error` which is inside `#no-game-panel` (hidden). Admin sees an authenticated header but a black empty body with no console errors.

2. **fly CLI not in Git Bash on Windows.** Must use PowerShell or install fly. `iwr https://fly.io/install.ps1 -useb | iex` installs it.

3. **Firebase project is shared.** The `nodicetools` Firebase project is also used by another tool (No Dice poll tool). Firestore rules and auth settings affect both. Don't break existing Firestore security rules.

4. **Firestore `isAdmin` doc must be created manually.** When a new Google account signs in for the first time, no Firestore doc is auto-created. You must manually create `users/{uid}` with `isAdmin: true` in the Firebase Console. Find the uid under Authentication → Users.

5. **GitHub Pages path prefix.** The frontend is served from a subpath (`/werewolfware/`), not root. Any absolute paths in HTML/JS will break. Always use relative paths or the existing path-fixing logic in the workflows.

6. **Backend cold starts on Fly.io free tier.** If the backend hasn't had traffic recently it may sleep. First connection after sleep can take 5-10 seconds — socket.io will retry automatically.
