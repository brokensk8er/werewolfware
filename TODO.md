# Werewolfware — TODO & Roadmap

**Last audited:** 2026-11-13 — every source file read, then a 30-player game run at phone size (375 x 667, touch) against a local copy. Findings and the screen designs are in the design proposal (a Claude doc titled "Werewolfware: Mobile and Admin Design Proposal").
**Last changed:** 2026-11-19 — Pass B (one view per phone, permanent player ids, server split) merged. `tests/phone-check`: 51 rule checks and 65 phone-size checks pass, and every deploy waits for them.
**Use case:** one in-person game per year, 10–30 players, run by a moderator from the admin panel with the app as an *aid*. The project sits mothballed between uses.
**Goal:** it works on the night, it is cheap to dust off a year later, and a new role or game mode is *one file + one registry line*.

> Read order for a new session: this file → `PROJECT_STATE.md` → the one slice you're working on. Don't read all of `server.ts` (1070 lines) unless the task needs it. For game-logic work, `backend/src/engine/gameManager.ts` (390 lines) is usually enough.

---

## Decisions

| ID | Decision | Status | Gates |
|----|----------|--------|-------|
| D1 | In-person moderated vs remote self-running | **RESOLVED 2026-11-01: in-person moderated.** The admin panel drives every phase; the app is an aid. One game per evening. | Player-side host controls are *removed* (P1-03). Auto-timers, remote wolf chat, rematch flow are deferred (see "Deferred"). |
| D2 | Wolf kill tie (wolves pick different targets) | **RESOLVED 2026-11-16: the most-chosen target dies; an even split is broken at random.** Built in Pass A2. | — |
| D3 | Day-vote tie | **RESOLVED 2026-11-16: a tie at the top eliminates nobody, and the tie is announced.** Built in Pass A2. | — |
| D4 | Reveal role on death? (currently always) | **RESOLVED 2026-11-16: keep revealing.** | Pass E role design (Witch/Hunter/Jester interact with it) |
| D5 | How night runs on phones *(proposal decision 1)* | **RESOLVED 2026-11-16: only roles with a night action choose. Everyone else sees a waiting screen ("Zzz… the werewolves are plotting"). Day and night have different colour themes that blend smoothly from one to the other.** | Pass C |
| D6 | Werewolves see their pack *(2)* | **RESOLVED 2026-11-16: yes, on the role card, shown only while held.** | Pass C |
| D7 | Town Square chat for the living *(3)* | **RESOLVED 2026-11-16: replace with private notes (seer results, your votes). Ghost chat for the dead stays.** | Pass C |
| D8 | Votes on phones *(4)* | **RESOLVED 2026-11-16: hidden until the moderator closes voting.** Server side built in Pass A2: phones no longer receive anyone else's votes. | Pass C (screens) |
| D9 | What the Seer learns *(5)* | **RESOLVED 2026-11-16: the team only ("village" or "werewolf").** Built in Pass A2. | — |
| D10 | Role mix *(6)* | **RESOLVED 2026-11-16: about one werewolf per six players.** Built in Pass A2 as `round(players / 6)`, at least 1: 5–8 players 1, 9–14: 2, 15–20: 3, 21–26: 4, 27–30: 5. Becomes the suggested mix on the Setup screen in Pass D. | Pass D |
| D11 | Moderator sign-in *(7)* | **RESOLVED 2026-11-16: Google sign-in only. No passcode fallback.** Pre-event check: sign in on a real phone. | — |
| D12 | Hosting *(8)* | **RESOLVED 2026-11-16: Fly only.** The game server serves the player and moderator pages; GitHub Pages and the socket.io CDN are retired. | Pass F |

Numbers in brackets are the decision numbers in the design proposal.

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

## Pass A2 — Rule fixes and deploy gate  *(DONE 2026-11-18)*

Each line is covered by `tests/phone-check/rules.cjs` or `verify.cjs`.

- [x] **One werewolf kill per night** *(P1-06, D2)*. Three wolves choosing three people used to kill all three.
- [x] **Vote ties eliminate nobody** *(P1-07, D3)*; only living voters and living targets count; the Mayor still counts twice.
- [x] **Every vote and night choice is checked** *(P1-04)*, whether a player or the moderator makes it: dead players cannot vote or act; no voting for the dead or yourself; no self-target except the Doctor (`canTargetSelf` on the role); werewolves cannot target the pack; votes only by day, actions only by night.
- [x] **Chat limits** *(P1-04)*: no town chat from the dead, 300 characters, one message a second. Ghost chat has the same limits.
- [x] **Votes hidden from phones** *(D8)*. A phone learns only its own vote (`vote:recorded`), including one the moderator casts for it. Moderators still see the running tally.
- [x] **Seer learns the team only** *(D9)*.
- [x] **About one werewolf per six players; the cap is 30 and is enforced** on join, on Add Player and at Start *(P1-01, D10)*.
- [x] **Moderator fixes:** Eliminate checks for a win; End Game announces "ended by the moderator" (not a village win) and still shows everyone's role; Mayor added to Change Role; Change Role refused in the lobby and after the end; the log is kept at game end and is not doubled after a reconnect; timer must be 5 seconds to 60 minutes; Add Player and Rename use the same name rules as joining.
- [x] **Small items:** fair Fisher–Yates shuffle *(P1-09)*; rejoin tokens are `crypto.randomUUID()` *(P1-12)*; phase timers come from one place, so the day is 60 seconds and the night 30 unless the moderator sets a timer *(P1-05)*.
- [x] **Phones highlight a choice only once the server accepts it**, and the vote list leaves out the viewer.
- [x] **Deploy gate.** `.github/workflows/check.yml` type-checks the server and runs `tests/phone-check` (one retry for a slow runner). Both deploys run it first and deploy only if it passes. It also runs on every pull request and branch push.
- [x] **Node 24** in both Dockerfiles and the workflows (Node 18 was past end-of-life).

## Pass B — One view per phone  *(DONE 2026-11-19)*

Covered by `tests/phone-check` (rules.cjs, and verify.cjs game 3, which refreshes every phone at five points in a game and compares the screen before and after).

- [x] **`server.ts` split** into `handlers/{player,admin}.ts`, `state.ts`, `view.ts`, `actions.ts`, `messaging.ts`, `helpers.ts`, `adminAuth.ts`, `flavor.ts`. The split itself was a verbatim move with all checks passing *(P2-01)*.
- [x] **Permanent player id** *(P2-00)*. Set when a player joins (a UUID), never the connection id. Each connection joins a room named after the id, so a reconnect only attaches the new connection; `reassignPlayerId` and its re-keying are gone. A player counts as offline only when their last connection closes.
- [x] **One view per phone** (`game:view`, built in `view.ts`): phase, round, timer, your role, your pack (werewolves, D6), your vote, your night choice, your notes, the player list, the end result. It carries only what that player may know. `guardSocket` sends fresh views to every phone and moderator after every handled event, so no handler has to remember who to tell.
- [x] **The pages redraw from the latest view.** A refresh, a reconnect and a normal update take the same path. The moderator panel likewise redraws from `admin:view` (the log still streams).
- [x] **Private notes on the server**, per player: the Seer's results survive a refresh and show on the role card *(audit item 11)*.
- [x] **Fixed:** a role change mid-game reaches the phone at once *(item 8)*; the moderator panel shows roles after a reload *(item 13)*; the Mayor title follows the role *(item 8)*; announcements are kept in the chat history; werewolves see their pack on the role card (D6, ahead of the Pass C screens); villagers get a waiting message at night (D5, first draft).
- [x] **Fixed a Pass A2 bug:** after the first day every later phase ran 60 seconds, nights included (the day length was being saved as a custom timer).
- [x] **Moderator panel** marks who has chosen this phase (✓) and who is offline.

### What comes next (from the design proposal)

| Pass | Work | Where it lives below |
|------|------|----------------------|
| B. One snapshot per phone | **Done 2026-11-19** (above) | — |
| C. Player phone | New screens: one job per phase, role hidden until held, confirm before a choice counts, day/night colour themes | New. Decisions D5–D8 recorded |
| D. Moderator panel | Setup with role counts, Run with a result preview, player sheet, bring-back and undo | New |
| E. Rules and roles | Night-action pipeline, Hunter, more roles, engine unit tests, payload schemas | Rest of Pass 1, Pass 2, Pass 3 |
| F. Before the event | Fly-only hosting (D12), load script, real-phone rehearsal, runbook | Pass 4 |

Still open from the audit: low text contrast (item 18), and the page layout itself (Pass C).

---

## Pass 1 — Harden + safety net  *(what is left after passes A and A2)*

Do in this order. Tests first so Pass 2's refactor has a net.

- [ ] **P1-00 Test harness + smoke test.** *(the CI workflow and the socket and browser checks exist: `tests/phone-check`. Engine unit tests with Vitest are still open.)* Vitest + `npm test`; `tsc --noEmit` and tests in a *separate* CI workflow (no deploy). Add `npm run smoke`: a `socket.io-client` script that boots the server, joins 5 bots, starts, runs a night and a day, and asserts the process is still alive. Turn every "Ran" finding in the log above into a test (`it.fails` until fixed, so each fix flips one green).
- [x] **P1-01 Phase and join guards.** *(Pass A; `maxPlayers` in Pass A2)*
  - Reject `game:advancePhase` and admin **Force Phase** while `phase === 'lobby'` (the moderator must Start first); make advancing from `ended` a no-op.
  - Reject `lobby:join` unless `phase === 'lobby'` (latecomers join before Start; spectator mode is Pass 3, low priority).
  - Enforce `maxPlayers` on join and on start.
  - Validate names in `lobby:join` / `addPlayer`: trim, 1–20 chars, strip control characters, case-insensitive unique.
- [ ] **P1-02 Crash guard + payload validation.** *(crash guard done in Pass A; per-event Zod schemas still open)* Every socket event gets a Zod schema; a bad or missing payload returns an `error` event instead of throwing. Wrap handlers in a `safe()` helper that catches, logs and emits `error`. Add `process.on('uncaughtException' | 'unhandledRejection')` that *logs and keeps serving* (losing the whole game is worse than one bad event).
- [x] **P1-03 Remove player-side host controls (D1).** Delete `game:start`, `game:advancePhase`, `game:setMode` and `lobby:create` from the player namespace, and the matching host buttons in the client (check `frontend/client.js` for references first). The admin namespace is the only driver. `admin:createGame` stays the only way to make a game.
- [x] **P1-04 Action validation.** *(Pass A2)*
  - `vote:cast`: voter alive, `canVoteDuringDay`, target exists and alive. `resolveDay` also ignores dead voters.
  - `night:action` and `admin:submitNightAction`: actor alive, target exists and alive, self-target only where the role allows (Doctor); wolves can't target wolves.
  - `chat:send`: reject from dead players (they use `ghost:send`), reject empty, max 300 chars, rate limit ~1 msg/sec/player.
  - `dayVotes` / `nightActions` are written only through validated helpers.
- [x] **P1-05 Timer/phase sanity.** *(Pass A2)* `advancePhase` hardcodes `30 * 1000` and ignores `PhaseManager.getPhaseDuration`. Use one source (`customPhaseDuration ?? getPhaseDuration(phase)`) in `startGame`, `resolveAndAdvance` and admin start. Timers stay display-only (D1).
- [x] **P1-06 Wolf pack kill.** *(Pass A2)* `resolveNight` adds *each* wolf's target to `killTargets`. Resolve one pack target per night: plurality of wolf picks, ties per **D2**.
- [x] **P1-07 Day-vote tie.** *(Pass A2)* `resolveDay` uses strict `>`, so the first entry in Map order wins ties. Detect ties and apply **D3**. If the top target is already dead, don't waste the vote silently.
- [x] **P1-08 De-duplicate start/vote logic.** *(Pass A2: `applyVote` and `applyNightAction` serve players and the moderator alike)* `game:start` and `admin:startGame` copy the same role-emission block; extract `startGameAndAnnounce(roomCode)` (after P1-03 only the admin copy survives, so this may collapse to a rename). Extract `notifyVoteCast(...)` so `admin:castVote` also fires the player notifications (open item in `HANDOFF.md`). Replace the hardcoded `${5}` with `game.gameMode.minPlayers`.
- [x] **P1-09 Fair shuffle.** *(Pass A2)* Replace `roles.sort(() => Math.random() - 0.5)` in `classic.ts` with Fisher–Yates.
- [ ] **P1-10 Docs sync.** Keep `PROJECT_STATE.md` / README accurate as items land.
- [x] **P1-11 Disconnect detection.** Store `socket.data.roomCode` on create/join/rejoin and read it in the `disconnect` handler (or use the `disconnecting` event, where rooms are still populated). Add a two-socket test.
- [x] **P1-12 Rejoin tokens.** *(cleanup in Pass A; `crypto.randomUUID()` in Pass A2)* Replace `Math.random()` + timestamp with `crypto.randomUUID()`, and delete a game's tokens in `admin:endGame`.

**Exit criteria:** `npm test` and `npm run smoke` green · lobby Force Phase, payload-less emits and a late join all return a clean `error` and the server stays up · 3 wolves = 1 death per night · tie handled per D3 · a disconnected player shows as disconnected · deployed and smoke-tested against the real Fly app *(see Deploy hygiene)*.

---

## Pass 2 — Extensibility refactor  *(no gameplay change; ~1–2 sessions)*

Behavior must stay identical to Pass 1's tests until P2-03 lands. Order matters.

- [x] **P2-00 Stable player id.** *(Pass B)* Today a player's id *is* their socket id, and `reassignPlayerId` re-keys five structures by hand on every rejoin (`dayVotes`, `nightActions`, `protectedPlayers`, `seerInvestigations`, `hostId`). Every future role adds more state to re-key, and a missed one breaks silently after a reconnect. Give players a stable UUID `playerId`; keep `socketId` as a mutable field that only the transport layer reads. Do this *before* adding roles.
- [x] **P2-01 Split `server.ts`** *(Pass B; the layout differs slightly from the one proposed here)* into `handlers/{lobby,game,chat,admin}.ts` plus `helpers/{announce,adminEmit}.ts`. Pure move, tests stay green. This also cuts tokens per future edit.
- [ ] **P2-02 One role registry.** `roles/index.ts` exports `ROLES: Record<string, Role>`. `ClassicMode.getRoles()` and `admin:changeRole` both read it (kills `ROLE_REGISTRY: Record<string, any>` in `server.ts`).
- [ ] **P2-03 Night-action pipeline.** Give `Role` a `nightPriority` and move behavior out of `resolveNight`'s `if (role.id === ...)` chain into the role files. Engine sorts by priority (block → protect → kill → investigate) and passes a context (`game`, `actor`, `target`, `effects`). Effects (kill / protect / block / reveal / message) are collected, then applied once. Werewolf, Doctor and Seer become the first three implementations.
- [ ] **P2-04 Hooks for the rest.** `voteWeight?()` (Mayor's double vote leaves `resolveDay`), `onAssign?()` / a `publicTitle` (Mayor's "Mayor " name prefix leaves `startGame`, and `admin:changeRole` stops leaving a stale prefix), and actually call `onDeath` for every death path (night, vote, admin eliminate). (The win check after `admin:eliminate` was added in Pass A2.)
- [ ] **P2-05 Composable win conditions.** `WinChecker` iterates conditions from roles and the mode. Support `solo` teams; delete the dead, duplicated `Werewolf.checkWinCondition`.
- [ ] **P2-06 Mode owns its rules.** `GameMode` gains `nightSeconds`, `daySeconds`, optional `winConditions`. `PhaseManager` reads them from the mode. (`game:setMode` was removed in P1-03; if a second mode ever exists, add mode selection to the admin lobby.)
- [ ] **P2-07 Proof of extensibility.** Add **Hunter** (on death, takes another player with them) using *only* a new role file + one registry line. If the engine needs any edit to do this, the pipeline isn't done.
- [ ] **P2-08 Type tightening.** Remove `any` on `adminNS`, `ROLE_REGISTRY`, snapshot returns. (Payload validation is already in P1-02.)
- [ ] **P2-09 Contract docs.** Rewrite README's "Adding New Roles" to match reality (the current "no engine changes needed" claim is only true after P2-03).

**Exit criteria:** adding Hunter touched no engine file · all Pass 1 tests still green · `server.ts` handlers each under ~200 lines · a rejoin test covers a Hunter-style pending-state role.

---

## Pass 3 — Party scale (10–30 players)  *(scoped after Pass 2)*

- [x] Classic scaling to 30: about one werewolf per six players, cap 30 enforced *(Pass A2, D10)*.
- [ ] More than one power role per team at large sizes (the Setup screen in Pass D lets the moderator set counts).
- [ ] New roles: Witch, Sheriff (Hunter done in P2-07); Jester as the first `solo` role.
- [ ] **30-bot load test** (`socket.io-client` script or Artillery's socket.io engine): joins, disconnects/rejoins and votes. Run it against the deployed app before the event.
- [x] Vote display: phones no longer receive anyone else's votes *(Pass A2, D8)*.
- [ ] *Low priority:* ghost votes / spectator tally for the dead; latecomer spectator mode (the moderator can add people in the lobby, so mid-game joins stay rejected).

## Pass 4 — Ops, mothballing & polish

### Deploy hygiene
- A push to `main` that touches `backend/**` (or the Dockerfile or `fly.toml`) deploys to Fly; one that touches `frontend/**` publishes to Pages. Docs-only changes trigger neither.
- Since Pass A2 both deploys first run `check.yml` (type check plus `tests/phone-check`) and deploy only if it passes. A failed check leaves the live site unchanged.
- **Don't merge code in the two weeks before an event.**

### Annual pre-event checklist (T-2 weeks)
1. **Check Node.** Both Dockerfiles and all three workflows use Node 24 (moved from 18 on 2026-11-18). If it is near end-of-life, move them all *together* to the current LTS (nodejs.org/en/about/previous-releases); the Check workflow tests the change before it deploys.
2. Run the Check workflow by hand (GitHub → Actions → Check → Run workflow), or locally: `cd tests/phone-check && npm ci && npx playwright install chromium && npm test`.
3. `fly status`: exactly **one** machine. A second one means two separate in-memory games and "No active game found" for half the room.
4. Deploy from clean `main`; confirm `/api/health`.
5. Admin login works **on a real phone** (D11: Google sign-in is the only way in): Firebase service account secret valid, your user doc has `isAdmin`, the site's domain is on the Firebase authorised list. Create a game, add bots, play a full bot game through the admin panel.
6. 30-bot load test against the deployed app.
7. Test on the venue's wifi with real phones; have the LAN fallback ready (below).
8. Check Fly billing/payment method and the Fly token secret in GitHub Actions (and that Pages still publishes, until D12 retires it).

### Other items
- [ ] Configurable server URL in the client (LAN / laptop fallback for bad venue wifi); self-host option on the homelab behind a Cloudflare Tunnel.
- [ ] **Fly-only hosting (D12):** serve the socket.io browser file from the server instead of the CDN, point the pages at their own origin, stop the Pages deploy, and add the Fly domain to Firebase's authorised list. Then tighten CORS (`origin: '*'`) to same-origin.
- [ ] Landscape / <375px layout fixes (likely absorbed by Pass C).
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
