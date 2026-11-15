# Werewolfware — TODO & Roadmap

**Last audited:** 2026-11-13 — every source file read, then a 30-player game run at phone size (375 x 667, touch) against a local copy. Findings and the screen designs are in the design proposal (a Claude doc titled "Werewolfware: Mobile and Admin Design Proposal").
**Last changed:** 2026-11-15 — Pass A (night-stoppers) merged. `tests/phone-check` passes 47 of 47.
**Use case:** one in-person game per year, 10–30 players, run by a moderator from the admin panel with the app as an *aid*. The project sits mothballed between uses.
**Goal:** it works on the night, it is cheap to dust off a year later, and a new role or game mode is *one file + one registry line*.

> Read order for a new session: this file → `PROJECT_STATE.md` → the one slice you're working on. Don't read all of `server.ts` (1070 lines) unless the task needs it. For game-logic work, `backend/src/engine/gameManager.ts` (390 lines) is usually enough.

---

## Decisions

| ID | Decision | Status | Gates |
|----|----------|--------|-------|
| D1 | In-person moderated vs remote self-running | **RESOLVED 2026-11-01: in-person moderated.** The admin panel drives every phase; the app is an aid. One game per evening. | Player-side host controls are *removed* (P1-03). Auto-timers, remote wolf chat, rematch flow are deferred (see "Deferred"). |
| D2 | Wolf kill tie (wolves pick different targets) | Default: random among tied targets. *Alternative that fits D1:* the moderator submits the pack's single target via `admin:submitNightAction`. | P1-06 |
| D3 | Day-vote tie | Default: no elimination, announce the tie | P1-07 |
| D4 | Reveal role on death? (currently always) | Default: keep revealing | Pass 3 role design (Witch/Hunter/Jester interact with it) |

---

## Verification log (2026-11-01)

"Ran" = reproduced against a scratch copy of the backend with real sockets (or the engine directly). "Reading" = traced in code only.

| # | Finding | Evidence | Tracked as |
|---|---------|----------|------------|
| 1 | `game:advancePhase` in the lobby makes the process exit (engine jumps to night, win checker sees 0 wolves → "village wins", end summary reads `role.name` of null). Admin **Force Phase** uses the same function. | Ran (player path); admin path by reading | P1-01 |
| 2 | An event with no payload (`socket.emit('lobby:join')`) makes the process exit. Same destructuring pattern elsewhere. | Ran | P1-02 |
| 3 | A late joiner is accepted after start with `role: null`; the crash arrives at the game-end summary. | Accepted: ran. Crash: reading | P1-01 |
| 4 | A non-host player can `game:start` and `game:advancePhase`. | Ran | P1-03 |
| 5 | A vote for a nonexistent target is accepted; a dead voter's vote counts; votes on an already-dead target are wasted ("inconclusive"). | Ran (engine + socket) | P1-04 |
| 6 | Chat accepts empty and 5000-character messages. | Ran | P1-04 |
| 7 | Night targets aren't validated (self, dead, wolf teammates). | Reading | P1-04 |
| 8 | 3 wolves choosing 3 targets kill 3 players. | Ran (engine) | P1-06 |
| 9 | A 1–1 vote tie eliminates whoever was inserted first. | Ran (engine) | P1-07 |
| 10 | Disconnects are never detected: the `disconnect` handler finds the room via `socket.rooms`, which Socket.IO has already emptied. No indicator, no "waiting for them" message. | Ran | P1-11 |
| 11 | **Rejoin works:** role and phase restored, vote works under the new id. | Ran | OK |
| 12 | `maxPlayers` (20) is never enforced. At 30 players: 4 wolves, 23 villagers, 1 of each power role. | Ran + grep | P1-01 / Pass 3 |
| 13 | Doctor save works (0 deaths when the wolf target is protected). | Ran (engine) | OK |
| 14 | Rejoin tokens are `Math.random()` + timestamp; whoever holds one takes the seat. | Reading + sample tokens | P1-12 |
| 15 | `PhaseManager`'s 60s day timer is never used; every phase is 30s. | Reading | P1-05 |

---

## Pass A — Night-stoppers  *(DONE 2026-11-15)*

Found by the 2026-11-13 phone-size audit. Each line is covered by a check in `tests/phone-check`.

- [x] **Host buttons on every phone.** Start Game and Advance Phase showed and worked on every player's phone (the `hidden` class had no style rule for those blocks, and the server did not check who asked). Buttons and the player-side handlers `game:start`, `game:advancePhase`, `game:setMode`, `lobby:create` are deleted. *(was P1-03; the earlier note that the buttons "never show" was wrong)*
- [x] **Dropped connections repaired.** The phone sends its rejoin token on every connect, not only on page load. The room is recorded on the socket, so drops are detected *(P1-11)*. Connection changes go to the moderator log, not the room chat.
- [x] **Moderator list scrolls on phones.** With 30 players, Start Game and every row are reachable at 375 x 667, 390 x 844 and 768 x 1024.
- [x] **Advance Phase refused in the lobby and after the end** *(part of P1-01)*.
- [x] **Bad events cannot stop the server.** Every handler is wrapped; a missing payload becomes `{}`; `uncaughtException` / `unhandledRejection` are logged *(the crash-guard half of P1-02; Zod schemas are still open)*.
- [x] **Late joiners turned away; names trimmed, 1–20 characters, unique** *(part of P1-01)*.
- [x] **Mid-game removal is safe.** Player lists always carry alive/connected flags; the removed player's token, vote and night action are dropped; they land back on the join screen.
- [x] **End screen works on living phones.** Results show, the phase panel and timer clear, Return to Lobby works.
- [x] **Choices survive redraws.** A timer change, a reconnect or a removal no longer clears a player's highlight or the vote counts.
- [x] **Moderator errors visible** in a banner on every view; **fresh sign-in token on each connect**; **log panel only under its own tab**.
- [x] **Rejoin tokens cleared** when a game ends or a player is removed *(part of P1-12; `crypto.randomUUID()` is still open)*.

Deliberately not done here: `maxPlayers` is **not** enforced. `ClassicMode.maxPlayers` is 20 and the goal is 30, so enforcing it would block the target game size. Raise the limit together with the 30-player role table (Pass 3).

### What comes next (from the design proposal)

| Pass | Work | Where it lives below |
|------|------|----------------------|
| B. One snapshot per phone | Server sends each player their whole view after every change; the page redraws from it; stable player id | New, absorbs P2-00 |
| C. Player phone | New screens: one job per phase, role hidden until held, confirm before a choice counts | New. Needs proposal decisions 1–4 |
| D. Moderator panel | Setup with role counts, Run with a result preview, player sheet, bring-back and undo | New |
| E. Rules and roles | Pack kill, ties, validation, night-action pipeline, Hunter, scaling to 30 | Rest of Pass 1, Pass 2, Pass 3 |
| F. Before the event | One host, Node upgrade, load script, real-phone rehearsal, runbook | Pass 4 |

Still open from the audit and not yet in a pass below: Change Role leaves the phone's night screen stale and is discarded if used in the lobby; Mayor is missing from the Change Role list; a refresh loses private results (seer findings); roles show as a dash after a moderator reload; the log is wiped at game end; Eliminate does not check for a win; End Game announces a village win; low text contrast. All are covered by passes B–D.

---

## Pass 1 — Harden + safety net  *(what is left after Pass A)*

Do in this order. Tests first so Pass 2's refactor has a net.

- [ ] **P1-00 Test harness + smoke test.** *(the browser-level check exists: `tests/phone-check`, run with `npm test` there. Engine unit tests with Vitest are still open.)* Vitest + `npm test`; `tsc --noEmit` and tests in a *separate* CI workflow (no deploy). Add `npm run smoke`: a `socket.io-client` script that boots the server, joins 5 bots, starts, runs a night and a day, and asserts the process is still alive. Turn every "Ran" finding in the log above into a test (`it.fails` until fixed, so each fix flips one green).
- [ ] **P1-01 Phase and join guards.** *(done in Pass A except `maxPlayers`, see above)*
  - Reject `game:advancePhase` and admin **Force Phase** while `phase === 'lobby'` (the moderator must Start first); make advancing from `ended` a no-op.
  - Reject `lobby:join` unless `phase === 'lobby'` (latecomers join before Start; spectator mode is Pass 3, low priority).
  - Enforce `maxPlayers` on join and on start.
  - Validate names in `lobby:join` / `addPlayer`: trim, 1–20 chars, strip control characters, case-insensitive unique.
- [ ] **P1-02 Crash guard + payload validation.** *(crash guard done in Pass A; per-event Zod schemas still open)* Every socket event gets a Zod schema; a bad or missing payload returns an `error` event instead of throwing. Wrap handlers in a `safe()` helper that catches, logs and emits `error`. Add `process.on('uncaughtException' | 'unhandledRejection')` that *logs and keeps serving* (losing the whole game is worse than one bad event).
- [x] **P1-03 Remove player-side host controls (D1).** Delete `game:start`, `game:advancePhase`, `game:setMode` and `lobby:create` from the player namespace, and the matching host buttons in the client (check `frontend/client.js` for references first). The admin namespace is the only driver. `admin:createGame` stays the only way to make a game.
- [ ] **P1-04 Action validation.**
  - `vote:cast`: voter alive, `canVoteDuringDay`, target exists and alive. `resolveDay` also ignores dead voters.
  - `night:action` and `admin:submitNightAction`: actor alive, target exists and alive, self-target only where the role allows (Doctor); wolves can't target wolves.
  - `chat:send`: reject from dead players (they use `ghost:send`), reject empty, max 300 chars, rate limit ~1 msg/sec/player.
  - `dayVotes` / `nightActions` are written only through validated helpers.
- [ ] **P1-05 Timer/phase sanity.** `advancePhase` hardcodes `30 * 1000` and ignores `PhaseManager.getPhaseDuration`. Use one source (`customPhaseDuration ?? getPhaseDuration(phase)`) in `startGame`, `resolveAndAdvance` and admin start. Timers stay display-only (D1).
- [ ] **P1-06 Wolf pack kill.** `resolveNight` adds *each* wolf's target to `killTargets`. Resolve one pack target per night: plurality of wolf picks, ties per **D2**.
- [ ] **P1-07 Day-vote tie.** `resolveDay` uses strict `>`, so the first entry in Map order wins ties. Detect ties and apply **D3**. If the top target is already dead, don't waste the vote silently.
- [ ] **P1-08 De-duplicate start/vote logic.** `game:start` and `admin:startGame` copy the same role-emission block; extract `startGameAndAnnounce(roomCode)` (after P1-03 only the admin copy survives, so this may collapse to a rename). Extract `notifyVoteCast(...)` so `admin:castVote` also fires the player notifications (open item in `HANDOFF.md`). Replace the hardcoded `${5}` with `game.gameMode.minPlayers`.
- [ ] **P1-09 Fair shuffle.** Replace `roles.sort(() => Math.random() - 0.5)` in `classic.ts` with Fisher–Yates.
- [ ] **P1-10 Docs sync.** Keep `PROJECT_STATE.md` / README accurate as items land.
- [x] **P1-11 Disconnect detection.** Store `socket.data.roomCode` on create/join/rejoin and read it in the `disconnect` handler (or use the `disconnecting` event, where rooms are still populated). Add a two-socket test.
- [ ] **P1-12 Rejoin tokens.** *(token cleanup done in Pass A; `crypto.randomUUID()` still open)* Replace `Math.random()` + timestamp with `crypto.randomUUID()`, and delete a game's tokens in `admin:endGame`.

**Exit criteria:** `npm test` and `npm run smoke` green · lobby Force Phase, payload-less emits and a late join all return a clean `error` and the server stays up · 3 wolves = 1 death per night · tie handled per D3 · a disconnected player shows as disconnected · deployed and smoke-tested against the real Fly app *(see Deploy hygiene)*.

---

## Pass 2 — Extensibility refactor  *(no gameplay change; ~1–2 sessions)*

Behavior must stay identical to Pass 1's tests until P2-03 lands. Order matters.

- [ ] **P2-00 Stable player id.** Today a player's id *is* their socket id, and `reassignPlayerId` re-keys five structures by hand on every rejoin (`dayVotes`, `nightActions`, `protectedPlayers`, `seerInvestigations`, `hostId`). Every future role adds more state to re-key, and a missed one breaks silently after a reconnect. Give players a stable UUID `playerId`; keep `socketId` as a mutable field that only the transport layer reads. Do this *before* adding roles.
- [ ] **P2-01 Split `server.ts`** into `handlers/{lobby,game,chat,admin}.ts` plus `helpers/{announce,adminEmit}.ts`. Pure move, tests stay green. This also cuts tokens per future edit.
- [ ] **P2-02 One role registry.** `roles/index.ts` exports `ROLES: Record<string, Role>`. `ClassicMode.getRoles()` and `admin:changeRole` both read it (kills `ROLE_REGISTRY: Record<string, any>` in `server.ts`).
- [ ] **P2-03 Night-action pipeline.** Give `Role` a `nightPriority` and move behavior out of `resolveNight`'s `if (role.id === ...)` chain into the role files. Engine sorts by priority (block → protect → kill → investigate) and passes a context (`game`, `actor`, `target`, `effects`). Effects (kill / protect / block / reveal / message) are collected, then applied once. Werewolf, Doctor and Seer become the first three implementations.
- [ ] **P2-04 Hooks for the rest.** `voteWeight?()` (Mayor's double vote leaves `resolveDay`), `onAssign?()` / a `publicTitle` (Mayor's "Mayor " name prefix leaves `startGame`, and `admin:changeRole` stops leaving a stale prefix), and actually call `onDeath` for every death path (night, vote, admin eliminate). Run the win check after `admin:eliminate` too.
- [ ] **P2-05 Composable win conditions.** `WinChecker` iterates conditions from roles and the mode. Support `solo` teams; delete the dead, duplicated `Werewolf.checkWinCondition`.
- [ ] **P2-06 Mode owns its rules.** `GameMode` gains `nightSeconds`, `daySeconds`, optional `winConditions`. `PhaseManager` reads them from the mode. (`game:setMode` was removed in P1-03; if a second mode ever exists, add mode selection to the admin lobby.)
- [ ] **P2-07 Proof of extensibility.** Add **Hunter** (on death, takes another player with them) using *only* a new role file + one registry line. If the engine needs any edit to do this, the pipeline isn't done.
- [ ] **P2-08 Type tightening.** Remove `any` on `adminNS`, `ROLE_REGISTRY`, snapshot returns. (Payload validation is already in P1-02.)
- [ ] **P2-09 Contract docs.** Rewrite README's "Adding New Roles" to match reality (the current "no engine changes needed" claim is only true after P2-03).

**Exit criteria:** adding Hunter touched no engine file · all Pass 1 tests still green · `server.ts` handlers each under ~200 lines · a rejoin test covers a Hunter-style pending-state role.

---

## Pass 3 — Party scale (10–30 players)  *(scoped after Pass 2)*

- [ ] Classic scaling table to 30 (`maxPlayers` 20 → 30; roughly 1 wolf per 4–5 players), plus more than one power role per team.
- [ ] New roles: Witch, Sheriff (Hunter done in P2-07); Jester as the first `solo` role.
- [ ] **30-bot load test** (`socket.io-client` script or Artillery's socket.io engine): joins, disconnects/rejoins and votes. Run it against the deployed app before the event.
- [ ] Vote display: `vote:updated` sends the full voter → target list to everyone, which undercuts the "ambiguous vote" flavor text. Decide which one you want.
- [ ] *Low priority:* ghost votes / spectator tally for the dead; latecomer spectator mode (the moderator can add people in the lobby, so mid-game joins stay rejected).

## Pass 4 — Ops, mothballing & polish

### Deploy hygiene (read before shipping any Pass 1/2 code)
- `deploy-backend.yml` runs on any push to `main` that touches `backend/**` and **deploys to Fly automatically**; `deploy-frontend.yml` publishes to Pages on `frontend/**`. Docs-only changes at the repo root trigger neither.
- So a merge to `main` that touches `backend/` or `frontend/` is a production deploy. Work on a branch per pass, merge only after tests and smoke pass, and **don't merge code in the two weeks before an event**.
- Consider removing the `push` trigger from `deploy-backend.yml` and deploying via `workflow_dispatch` only (it's already enabled), so a stray merge can't change production.

### Annual pre-event checklist (T-2 weeks)
1. **Bump Node.** `Dockerfile` uses `node:18-alpine` and `deploy-backend.yml` uses `node-version: '18'`; Node 18 is past end-of-life. Move both to a current LTS *together* (check nodejs.org/en/about/previous-releases), then re-run the tests and smoke test.
2. `cd backend && npm ci && npm run build && npm test && npm run smoke`.
3. `fly status`: exactly **one** machine. A second one means two separate in-memory games and "No active game found" for half the room.
4. Deploy from clean `main`; confirm `/api/health`.
5. Admin login works: Firebase service account secret valid, your user doc has `isAdmin`. Create a game, add bots, play a full bot game through the admin panel.
6. 30-bot load test against the deployed app.
7. Test on the venue's wifi with real phones; have the LAN fallback ready (below).
8. Check Fly billing/payment method, the Fly token secret in GitHub Actions, and that Pages still publishes.

### Other items
- [ ] Configurable server URL in the client (LAN / laptop fallback for bad venue wifi); self-host option on the homelab behind a Cloudflare Tunnel.
- [ ] Tighten CORS (`origin: '*'`) to the Pages domain; landscape / <375px layout fixes.
- [ ] Short runbook: the checklist above, `flyctl` commands, how to recover a stuck phase, and **what to do if the server restarts mid-game** (the moderator carries on by hand; state is lost).
- [ ] *Optional:* persist a JSON snapshot of game state (Fly volume or SQLite). Needs a plain-JSON state shape first (`Map`/`Set`/`Role` objects aren't serializable). Lower priority now: with one game a year, crash guards and not deploying on event day cover most of the risk.
- [ ] *Optional:* Dependabot security updates only (version bumps would be noise on a mothballed repo).

---

## Deferred / won't do (because of D1)

- Server-side phase auto-advance and "everyone acted, end night early" (the moderator drives).
- Private wolf chat channel and chat gating by phase (wolves confer in person). Revisit only if remote play is ever wanted.
- Rematch / reset flow (one game per evening; **End Game → Create Game** already works).
- Game stats / leaderboard (existing Won't Do).

---

## Session kickoff prompts (token-lean)

- **Pass 1:** "Read `TODO.md` and `PROJECT_STATE.md`. Do P1-00 through P1-04 only, on a branch. Show `git diff` and test output, not whole files."
- **Pass 2:** "Read `TODO.md`. Do P2-00 and P2-01 first (id change, then pure move) and confirm tests are unchanged before touching behavior."
- Keep each session to one pass-slice, and commit after each item so `git diff` stays small.
