# Phone check

Plays a real 30-player game at phone size and checks that the app survives the night:
no host buttons on player phones, phones that drop and reconnect, the moderator list
scrolling on a phone, bad events, a mid-game removal, the end screen, and a server restart.

It runs against a throwaway local copy in `.work/`. It never touches the live server,
and nothing here is part of a deploy.

## Run it

```bash
cd tests/phone-check
npm install
npx playwright install chromium   # first time only
npm test
```

It takes about two minutes and ends with `N of N checks passed`. Screenshots of the
key screens land in `.work/shots/`.

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
