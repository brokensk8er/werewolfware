# Werewolfware — TODO & Roadmap

**Last audited:** 2026-09-19 (code read against `main`; not yet load-tested)
**Goal:** an easy party-game app for running Werewolf with **10–30 players**, on a codebase where a new role or game mode is *one file + one registry line*.

> Read order for a new session: this file → `PROJECT_STATE.md` → the one slice you're working on. Don't read all of `server.ts` (1070 lines) unless the task needs it.

---

## Open decisions (these gate specific items)

| ID | Decision | Default if undecided | Gates |
|----|----------|----------------------|-------|
| D1 | **In-person moderated** (admin panel drives every phase) vs **remote self-running** (server timers, players on own phones) | In-person moderated | wolf chat, auto-timers, chat gating, host role |
| D2 | Wolf kill tie (wolves pick different targets) | Random among tied targets | P1-06 |
| D3 | Day-vote tie | No elimination, announce tie | P1-07 |
| D4 | Reveal role on death? (currently always revealed) | Keep revealing | Pass 3 role design (Witch/Hunter/Jester interact with it) |

---

## Pass 1 — Harden + safety net  *(stop crashes and cheating; ~1 session)*

Do in this order. Tests first so Pass 2's refactor has a net.

- [ ] **P1-00 Test harness.** Add Vitest + `npm test`; run `tsc --noEmit` and tests in CI (`.github/workflows`). Write *characterization tests* for `GameManager.resolveNight`, `resolveDay`, `WinChecker.checkWin`. Encode the known bugs (P1-06, P1-07) as `it.fails`/`it.todo` so fixes flip them green.
- [ ] **P1-01 Late-join crash.** `lobby:join` has no phase check; a mid-game joiner gets `role: null`, which throws at `p.role.name` (game-end summary, eliminations) and kills the process (all state is in memory). Reject joins unless `phase === 'lobby'` (spectator mode comes in Pass 3). Also validate names in `lobby:join`/`addPlayer`: trim, 1–20 chars, strip control chars, case-insensitive unique.
- [ ] **P1-02 Crash guard.** Wrap socket handlers in a `safe()` helper that catches, logs and emits `error`; add `process.on('uncaughtException' | 'unhandledRejection')` logging as a last resort.
- [ ] **P1-03 Host/permission gating.** `game:start`, `game:advancePhase`, `game:setMode`, `lobby:create` on the player namespace have no auth. Admin-created games have `hostId = ''`, so the client's host buttons never show, but anyone can emit these from the console. Require `socket.id === game.hostId` (and reject when `hostId` is empty). `lobby:create` is unused by the client: remove it, or restrict to when no game exists and the caller is admin. *(If D1 = in-person only, deleting the player-side handlers and buttons is simpler.)*
- [ ] **P1-04 Action validation.**
  - `vote:cast`: voter alive, `canVoteDuringDay`, target exists and alive.
  - `night:action`: actor alive, target exists and alive, self-target only where the role allows (Doctor).
  - `chat:send`: reject from dead players (they use `ghost:send`); max 300 chars; rate limit ~1 msg/sec/player.
  - `dayVotes`/`nightActions` are only ever written through validated helpers.
- [ ] **P1-05 Timer/phase sanity.** `advancePhase` hardcodes `30 * 1000` and ignores `PhaseManager.getPhaseDuration`. Use one source (`customPhaseDuration ?? getPhaseDuration(phase)`), and use it consistently in `startGame`, `resolveAndAdvance`, and admin start.
- [ ] **P1-06 Wolf pack kill.** `resolveNight` adds *each* wolf's target to `killTargets`, so 3 wolves choosing 3 people kills 3 people. Resolve one pack target per night: plurality of wolf picks, tie per **D2**.
- [ ] **P1-07 Day-vote tie.** `resolveDay` uses strict `>`, so the first entry in Map order wins ties. Detect ties and apply **D3**.
- [ ] **P1-08 De-duplicate start/vote logic.** `game:start` and `admin:startGame` copy the same role-emission block; extract `startGameAndAnnounce(roomCode)`. Extract `notifyVoteCast(...)` so `admin:castVote` also fires the player notifications (open item in `HANDOFF.md`). Replace the hardcoded `${5}` with `game.gameMode.minPlayers` (`server.ts` admin start, `client.js` start button).
- [ ] **P1-09 Fair shuffle.** Replace `roles.sort(() => Math.random() - 0.5)` in `classic.ts` with Fisher–Yates.
- [ ] **P1-10 Docs sync.** Keep `PROJECT_STATE.md` / README accurate as items land (stale "done/not done" lines were fixed 2026-09-19).

**Exit criteria:** `npm test` green in CI · a scripted bot game runs start-to-finish via admin · a late join and a console-emitted `game:advancePhase` both get a clean error · 3 wolves = 1 death per night · tie handled per D3 · `flyctl deploy` done and smoke-tested.

---

## Pass 2 — Extensibility refactor  *(no gameplay change; ~1–2 sessions)*

Behavior must stay identical to Pass 1's tests until P2-03 lands. Order matters.

- [ ] **P2-01 Split `server.ts`** into `handlers/{lobby,game,chat,admin}.ts` plus `helpers/{announce,adminEmit}.ts`. Pure move, tests stay green. This also cuts tokens per future edit.
- [ ] **P2-02 One role registry.** `roles/index.ts` exports `ROLES: Record<string, Role>`. `ClassicMode.getRoles()` and `admin:changeRole` both read it (kills `ROLE_REGISTRY: Record<string, any>` in `server.ts`).
- [ ] **P2-03 Night-action pipeline.** Give `Role` a `nightPriority` and move behavior out of `resolveNight`'s `if (role.id === ...)` chain into the role files. Engine sorts by priority (block → protect → kill → investigate) and passes a context (`game`, `actor`, `target`, `effects`). Effects (kill / protect / block / reveal / message) are collected, then applied once. Werewolf, Doctor and Seer become the first three implementations.
- [ ] **P2-04 Hooks for the rest.** `voteWeight?()` (Mayor's double vote leaves `resolveDay`), `onAssign?()` / a `publicTitle` (Mayor's "Mayor " name prefix leaves `startGame`), and actually call `onDeath` for every death path (night, vote, admin eliminate).
- [ ] **P2-05 Composable win conditions.** `WinChecker` iterates conditions from roles and the mode. Support `solo` teams; delete the dead, duplicated `Werewolf.checkWinCondition`.
- [ ] **P2-06 Mode owns its rules.** `GameMode` gains `nightSeconds`, `daySeconds`, optional `winConditions`. `PhaseManager` reads them from the mode. Either implement `game:setMode` (admin picks the mode in the lobby) or remove the stub.
- [ ] **P2-07 Proof of extensibility.** Add **Hunter** (on death, takes another player with them) using *only* a new role file + one registry line. If the engine needs any edit to do this, the pipeline isn't done.
- [ ] **P2-08 Type tightening.** Remove `any` on `adminNS`, `ROLE_REGISTRY`, snapshot returns; validate socket payloads with Zod.
- [ ] **P2-09 Contract docs.** Rewrite README's "Adding New Roles" to match reality (the current "no engine changes needed" claim is only true after P2-03).

**Exit criteria:** adding Hunter touched no engine file · all Pass 1 tests still green · `server.ts` handlers each under ~200 lines.

---

## Pass 3 — Party scale (10–30 players)  *(backlog, scoped after Pass 2)*

- [ ] Classic scaling table to 30 (`maxPlayers` 20 → 30; roughly 1 wolf per 4–5 players), plus more than one power role per team.
- [ ] New roles: Witch, Sheriff (Hunter done in P2-07); Jester as the first `solo` role.
- [ ] **Wolf team:** teammate reveal and a private wolf channel (needed if D1 = remote).
- [ ] Chat gating by phase; per-role channels; smaller/faster chat UI at 30 players.
- [ ] Dead-player engagement: ghost votes or a spectator vote tally.
- [ ] Latecomer **spectator** mode (replaces the Pass 1 hard reject).
- [ ] **30-bot load test:** socket.io-client script or Artillery (socket.io engine) with random joins, disconnects and votes.
- [ ] Vote display: `vote:updated` sends a full voter → target list to everyone, which undercuts the "ambiguous vote" flavor text. Decide which one you want.

## Pass 4 — Ops & polish  *(backlog)*

- [ ] Persist a JSON snapshot of game state and rejoin tokens (Fly volume or SQLite) so a restart or deploy doesn't wipe a live game.
- [ ] Configurable server URL in the client (LAN / laptop fallback for bad venue wifi); self-host option on the homelab behind a Cloudflare Tunnel.
- [ ] Server-side phase auto-advance and "everyone acted, end night early" (needed if D1 = remote).
- [ ] Tighten CORS (`origin: '*'`) to the Pages domain; rejoin-token expiry; landscape / <375px layout fixes.
- [ ] Short runbook: pre-show checklist, `flyctl` commands, how to recover a stuck phase.

---

## Session kickoff prompts (token-lean)

- **Pass 1:** "Read `TODO.md` and `PROJECT_STATE.md`. Do P1-00 through P1-04 only. Show `git diff` and test output, not whole files."
- **Pass 2:** "Read `TODO.md`. Do P2-01 (pure move) first and confirm tests are unchanged before touching behavior."
- Keep each session to one pass-slice, and commit after each item so `git diff` stays small.
