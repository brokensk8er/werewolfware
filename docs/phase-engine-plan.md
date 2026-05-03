# Phase Engine Refactor — Plan

## Context

Right now `gameManager.js` hardcodes the day/night state machine in a single
`if/else` inside `advancePhase()`. Adding any new role (Seer, Witch, Hunter,
Sheriff, etc.) requires modifying core engine code and threading new resolution
functions through the file. This refactor replaces the hardcoded machine with
a **phase queue + role registry** pattern: roles declare which phases they
inject, what actions they support during each phase, and how those phases
resolve. Adding a new role becomes a new file in `src/roles/` with zero
changes to engine code.

---

## Target Architecture

### Core engine modules (new)

```
src/engine/
├── phaseEngine.js       — phase queue, advancement, timer wiring
├── roleRegistry.js      — registers role definitions, role assignment
├── actionRegistry.js    — registers actions, validates + dispatches
└── winChecker.js        — runs each role's hasWon() to determine winner
```

### Role definitions (new)

```
src/roles/
├── villager.js
└── werewolf.js
```

Each role file is a self-contained module exporting a role definition object
(see schema below). Future roles drop in as additional files; registry picks
them up automatically.

### Modified files

- `src/gameManager.js` → becomes thin orchestrator (createGame, joinGame,
  startGame). All phase/action/win logic delegates to engine.
- `src/socketHandlers.js` → adds generic `action:perform` event that dispatches
  via `actionRegistry`. Keeps existing `vote:cast` and `werewolf:target` events
  as thin wrappers for client compatibility (no client changes needed).
- `src/roles.js` → deleted (logic moves into role files + engine).

---

## Role Definition Schema

```js
// src/roles/werewolf.js
export default {
  id: 'werewolf',
  name: 'Werewolf',
  emoji: '🐺',
  team: 'werewolves',
  description: 'Eliminate villagers under cover of night.',

  // How many players get this role for a given total
  countFor(totalPlayers) {
    return Math.max(1, Math.floor(totalPlayers / 3));
  },

  // Phases this role injects into the cycle
  // order: 0 = day, positive numbers = night phases sorted ascending
  phases: [
    {
      id: 'night:werewolf',
      order: 200,
      durationKey: 'nightDuration',  // pulls from game settings
      chatRoom: 'werewolf',
      allowedActions: ['wolf:select'],
      resolve(ctx) {
        // ctx: { game, recordedActions, eliminate, broadcast }
        const tally = tallyByTarget(ctx.recordedActions);
        const target = pickConsensus(tally);  // majority, ties = no kill
        if (target) ctx.eliminate(target, 'wolf');
        else ctx.broadcast('night:result', { reason: 'The wolves disagreed.' });
      },
    },
  ],

  // Actions this role can perform
  actions: {
    'wolf:select': {
      phase: 'night:werewolf',  // restrict to this phase
      validate(ctx, payload) {
        const target = ctx.game.players.get(payload.targetId);
        return target?.isAlive && target.role !== 'werewolf';
      },
      apply(ctx, payload) {
        // record actor's selection; broadcast to wolves
        ctx.recordAction({ actorId: ctx.actor.socketId, targetId: payload.targetId });
        ctx.broadcastToRoom('werewolf', 'wolf:selectionUpdate', {
          byName: ctx.actor.name,
          targetName: ctx.game.players.get(payload.targetId).name,
        });
      },
    },
  },

  // Per-player snapshot data (e.g. wolves see fellow wolves)
  snapshotFor(game, me) {
    if (me.role !== 'werewolf') return {};
    return {
      teammates: [...game.players.values()]
        .filter(p => p.role === 'werewolf' && p.socketId !== me.socketId)
        .map(p => ({ socketId: p.socketId, name: p.name })),
    };
  },

  // Win condition for this role's team
  hasWon(game) {
    const living = [...game.players.values()].filter(p => p.isAlive);
    const wolves = living.filter(p => p.role === 'werewolf').length;
    const others = living.length - wolves;
    return wolves > 0 && wolves >= others;
  },
};
```

```js
// src/roles/villager.js
export default {
  id: 'villager',
  name: 'Villager',
  emoji: '👤',
  team: 'villagers',
  description: 'Find and eliminate the wolves before they take over.',
  countFor() { return 0; },  // fills remaining slots after specials
  isFiller: true,            // engine flag: assign after all specials
  phases: [],                // no special phases; participates in `day`
  actions: {},
  snapshotFor() { return {}; },
  hasWon(game) {
    const living = [...game.players.values()].filter(p => p.isAlive);
    return living.every(p => p.role !== 'werewolf');
  },
};
```

---

## Phase Engine

### Built-in phases

Every game has a single built-in phase: **`day`** (order 0). It's not declared
by any role — it's the universal public discussion + vote phase. Everything
else is contributed by roles.

```js
// engine internal
const DAY_PHASE = {
  id: 'day',
  order: 0,
  durationKey: 'dayDuration',
  chatRoom: 'main',
  allowedActions: ['vote:cast'],
  resolve(ctx) {
    const tally = tallyByTarget(ctx.recordedActions);
    const livingVoters = countLiving(ctx.game);
    const result = pickMajority(tally, livingVoters);
    if (result) ctx.eliminate(result, 'vote');
    else ctx.broadcast('vote:result', { reason: "No majority." });
  },
};
```

`vote:cast` is registered by the engine itself, not by villager.js — every
living player can vote during day.

### Phase queue building

At game start (and after each cycle completes):

```js
function buildPhaseQueue(activeRoles, game) {
  const phases = [DAY_PHASE];
  for (const role of activeRoles) {
    phases.push(...role.phases);
  }
  // dedupe by id, sort by order
  return [...new Map(phases.map(p => [p.id, p])).values()]
    .sort((a, b) => a.order - b.order);
}
```

`activeRoles` = the set of role IDs assigned to at least one living player.
This naturally trims phases when, say, the seer dies (their phase is skipped
on the next cycle).

### Advancement

```js
function advancePhase(game) {
  if (game.timer) game.timer.cancel();

  // Resolve current phase
  if (game.phase !== 'lobby') {
    const phaseDef = phaseEngine.getPhase(game.phase);
    phaseDef.resolve(makeResolveContext(game));
  }

  // Check win
  const winner = winChecker.check(game, activeRoles);
  if (winner) return endGame(game, winner);

  // Pop next phase, regenerate queue if exhausted
  if (game.phaseQueue.length === 0) {
    game.phaseQueue = buildPhaseQueue(activeRoles(game), game);
  }
  const nextPhase = game.phaseQueue.shift();
  startPhase(game, nextPhase);
}
```

### Phase start

```js
function startPhase(game, phaseDef) {
  game.phase = phaseDef.id;
  game.recordedActions = new Map();
  game.phaseEndsAt = Date.now() + game[phaseDef.durationKey];
  game.timer = new PhaseTimer(...);
  game.timer.start();

  // Send phase change notification scoped to who can see it
  if (phaseDef.chatRoom) {
    io.to(`game:${game.id}:${phaseDef.chatRoom}`).emit('phase:changed', {
      phase: phaseDef.id, phaseEndsAt: game.phaseEndsAt,
    });
  }
  // Always notify admin
  io.to(`game:${game.id}:admin`).emit('admin:state', getAdminSnapshot(game));
}
```

---

## Action Registry

```js
// engine/actionRegistry.js
const actions = new Map();

export function register(actionId, definition) {
  actions.set(actionId, definition);
}

export function dispatch(game, actor, actionId, payload) {
  const def = actions.get(actionId);
  if (!def) return { error: 'Unknown action' };

  // Phase guard: action must be allowed in current phase
  const phaseDef = phaseEngine.getPhase(game.phase);
  if (!phaseDef.allowedActions.includes(actionId)) {
    return { error: 'Action not allowed in this phase' };
  }

  // Role guard: actor must have a role that owns this action
  // (vote:cast has no role guard — anyone living can vote)
  if (def.requiresRole && actor.role !== def.requiresRole) {
    return { error: 'Wrong role' };
  }
  if (!actor.isAlive) return { error: 'Dead players cannot act' };

  const ctx = makeActionContext(game, actor);
  if (!def.validate(ctx, payload)) return { error: 'Invalid action' };

  def.apply(ctx, payload);
  return { ok: true };
}
```

Each role's `actions` map is loaded into the registry at engine bootstrap.

---

## Werewolf Consensus (vote mechanics improvement)

**Current behavior:** last wolf to submit a target wins. Trivially abusable.

**New behavior (in werewolf.js's `night:werewolf.resolve`):**
- Each wolf casts a target via `wolf:select`
- At phase end, tally targets
- **Majority wins**; ties = no kill
- Optional config: `werewolfConsensus: 'majority' | 'unanimous'` on the game,
  default `majority`

This is encapsulated in `werewolf.js` so the rule can change without touching
engine code.

---

## Win Condition Checking

`winChecker.check(game, activeRoles)` iterates over distinct teams represented
in `activeRoles`, calls each role's `hasWon(game)`. First role whose team has
won returns that team. If no team wins, returns null.

For MVP this is just villagers vs werewolves. Future: a Lovers role could
introduce a third team.

---

## Migration Steps (in order)

Each step keeps the game runnable. Commit after each.

1. **Create engine skeleton (no behavior change).**
   - Add `src/engine/phaseEngine.js`, `roleRegistry.js`, `actionRegistry.js`
   - All initially export stub functions; nothing wired up

2. **Move villager + werewolf into role files.**
   - `src/roles/villager.js`, `src/roles/werewolf.js` with definitions above
   - `roleRegistry.register(villager)`, `roleRegistry.register(werewolf)` at
     bootstrap (server.js or socketHandlers.js init)
   - Old `src/roles.js` still in use; new files unused

3. **Switch role assignment to use registry.**
   - `gameManager.startGame()` calls `roleRegistry.assignRoles(players)`
   - Implementation iterates registered roles, applies `countFor(total)`,
     fills remainder with `isFiller: true` roles
   - Remove old `assignRoles` from `roles.js`

4. **Switch win checking.**
   - `gameManager` calls `winChecker.check(game, activeRoles(game))`
   - Old `checkWinCondition` in `roles.js` deleted

5. **Replace `advancePhase()` with phase engine.**
   - `gameManager.advancePhase` → `phaseEngine.advance(game)`
   - Old `_resolveDayVotes` and `_resolveNightKill` deleted (logic moved into
     `day` phase resolver and werewolf.js phase resolver)

6. **Wire actions through registry.**
   - Add `action:perform` socket event in `socketHandlers.js`
   - Keep existing `vote:cast` and `werewolf:target` events as wrappers that
     call `actionRegistry.dispatch` — no client changes needed
   - Implement `vote:cast` action (built into engine, not role-owned)
   - Implement `wolf:select` action (in werewolf.js)

7. **Update snapshots to call role.snapshotFor().**
   - `getStateSnapshot` collects role-specific data via the player's role's
     `snapshotFor()` and merges it into the snapshot
   - Removes the special-cased "expose fellow wolves" logic from the current
     snapshot code

8. **Delete `src/roles.js`.**
   - All its responsibilities now live in `src/engine/` + `src/roles/`

9. **Verify full game flow.**
   - 3-player game: lobby → day → night → day, voting + wolf kill resolve
     correctly, win conditions trigger at right time
   - Check chat room access (wolves see Wolf Den, dead see Beyond the Grave)
   - Admin sees all roles in player grid

---

## What Stays Identical

- All socket event names (`vote:cast`, `werewolf:target`, `chat:send`,
  `phase:changed`, `phase:tick`, `player:eliminated`, etc.) — client code
  unchanged
- All page routes (`/`, `/admin`, `/join`, `/player`)
- Game state shape from the client's perspective (snapshot fields preserved)
- Auth middleware stub (orthogonal to this refactor)

---

## Critical Files to Touch

**New:**
- `src/engine/phaseEngine.js`
- `src/engine/roleRegistry.js`
- `src/engine/actionRegistry.js`
- `src/engine/winChecker.js`
- `src/roles/villager.js`
- `src/roles/werewolf.js`

**Modified:**
- `src/gameManager.js` — slim down, delegate to engine
- `src/socketHandlers.js` — add `action:perform`, keep wrappers
- `server.js` — register roles at bootstrap

**Deleted:**
- `src/roles.js`

---

## Verification

```bash
npm run dev
# Open /admin in tab 1, create game, set short timers (30s/30s)
# Open /join?game=<id> in tabs 2-4, join with different names
# Start game; verify each player gets a role reveal
# Day: each player votes; verify majority kills, ties spare
# Night: wolf(es) submit targets; verify consensus rule (majority among wolves)
# Repeat until win condition fires
# Confirm Wolf Den chat works for wolves only, Beyond the Grave only after death
```

---

## Out of Scope (future work)

- Adding actual new roles (Seer, Witch, Hunter, Sheriff). The point of this
  refactor is to make those drop-in.
- Firebase Auth wiring.
- Persistence (Firebase RTDB or similar).
- Per-role chat rooms beyond the existing three (Wolf Den, Town Square,
  Beyond the Grave).
