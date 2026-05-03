# Werewolfware — Claude Instructions

## Git workflow

- Always commit and push directly to `main`.
- When there are multiple commits to push, squash them into a single commit first.
- Never push to a separate feature branch unless the user explicitly asks.
- Push to both `main` and the current branch to satisfy the stop hook:
  ```
  git push origin HEAD:main
  git push origin claude/werewolf-game-mvp-jq9Om
  ```
