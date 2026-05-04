# Werewolfware — Admin Panel Handoff

This document is a context dump for continuing work on the admin panel in a new chat session.

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
