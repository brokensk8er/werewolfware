# Phone check

Two checks, run in order by `npm test`:

- **`rules.cjs`** (about 20 seconds) drives games over plain socket connections and checks
  every game rule: one werewolf kill per night, vote ties, the Mayor's double vote, the
  Seer learning a team, hidden votes, who may vote or act, chat limits, names, the
  30-player cap and the role mix, moderator eliminations ending the game, End Game,
  and that each phone's view restores everything after a refresh and reveals no one
  else's role.
- **`verify.cjs`** (about two minutes) plays a real 30-player game at phone size: no host
  buttons on player phones, phones that drop and reconnect, the moderator list scrolling
  on a phone, bad events, a mid-game removal, the end screen, a server restart, and
  a refresh of every phone at five points in a game (the screen must come back the same).

It runs against a throwaway local copy in `.work/`. It never touches the live server,
and nothing here is part of a deploy.

## Run it

```bash
cd tests/phone-check
npm install
npx playwright install chromium   # first time only
npm test
```

Each part ends with `N of N checks passed`. Screenshots of the key screens land in
`.work/shots/`.

## On GitHub

`.github/workflows/check.yml` runs the type check and `npm test` on every pull request and
branch push. Both deploy workflows run it first and deploy only if it passes. It retries
once, so a slow runner does not block a deploy; a real bug fails both runs.

## When to run it

- After any change to `backend/` or `frontend/`, before merging to `main`.
- Once a year, two weeks before the game, after the Node and dependency updates.

## How it gets past Google sign-in

The local server is started with `ALLOW_TEST_ADMIN=1`, which accepts a fixed test token
for the moderator page. The server refuses that switch when `NODE_ENV=production` or
`FLY_APP_NAME` is set, which is always the case on Fly. The check verifies that refusal.

## Not covered

Real iPhones and Android phones. This uses a desktop Chromium set to phone size with
touch input. A rehearsal on real devices is still needed before the event.
