# Deployment Guide — Fly.io + GitHub Pages

## Project Status

**Werewolf/Mafia multiplayer game** — Node.js + TypeScript backend, static HTML/CSS/JS frontend.

- ✅ Backend: Express + Socket.io, fully typed, builds to ES modules
- ✅ Frontend: Static files in `/frontend/`, ready for GitHub Pages
- ✅ GitHub Actions: Workflows exist but need secrets configured
- ✅ Fly.toml: Configured for 256MB shared-cpu-1x VM, port 3000
- ⚠️ Not yet deployed anywhere

## Prerequisites

1. **Fly.io account** — https://fly.io (free tier includes 3 shared-cpu-1x VMs)
2. **Fly CLI** — Install via `brew install flyctl` or https://fly.io/docs/hands-on/install-flyctl/
3. **GitHub account** — Already have this
4. **GitHub auth token** — For Actions to deploy

## What's Already in Place

```
backend/
├── fly.toml                 # Fly.io config (app name, resources, env)
├── package.json             # Node.js deps + build scripts
├── tsconfig.json            # TypeScript config (ES2020 modules)
└── src/
    └── server.ts            # Express + Socket.io on port 3000

.github/workflows/
├── deploy-backend.yml       # Triggers on push to main (backend/** changes)
└── deploy-frontend.yml      # Triggers on push to main (frontend/** changes)
```

## Setup Steps

### 1. Fly.io App Creation

```bash
cd backend

# Login to Fly.io (opens browser)
flyctl auth login

# Create app (choose a name like "werewolf-game-prod")
flyctl launch
# → When prompted: Don't generate Dockerfile (we'll use Node.js buildpack)
# → Accept database? No
# → Deploy now? No (we'll do it via GitHub Actions)
```

This creates/updates `backend/fly.toml` with:
- App name (e.g., `werewolf-game-prod`)
- Org name
- Region (default is fine)

**Update `backend/fly.toml`:** Change `app = "werewolf-game"` to your actual app name.

### 2. Generate Deploy Token for GitHub Actions

```bash
flyctl auth token
# Copy the output token
```

Add to GitHub:
- Go to repo → **Settings → Secrets and variables → Actions**
- Click **New repository secret**
- Name: `FLY_API_TOKEN`
- Value: (paste token from above)

### 3. GitHub Pages Setup

Go to repo → **Settings → Pages**:
- Source: Deploy from a branch
- Branch: `gh-pages`
- Folder: `/ (root)`

(The GitHub Actions workflow `deploy-frontend.yml` will auto-create the `gh-pages` branch on first push.)

### 4. Test Locally Before Deploying

```bash
cd backend
npm run build
npm start
# Should see: "Server running on port 3000"
# Open http://localhost:3000 in browser
# Test: create game, join, send chat, advance phase
```

### 5. Push to Main & Trigger Workflows

```bash
git add .
git commit -m "Setup Fly.io + GitHub Pages deployment"
git push origin main
```

Check GitHub → **Actions tab**:
- `deploy-backend.yml` should start (if backend files changed)
- `deploy-frontend.yml` should start (if frontend files changed)

Monitor logs in Actions tab. First deploy may take 2-3 min.

### 6. Verify Deployments

**Backend (Fly.io):**
```bash
flyctl status
# Shows: "allocator: failed" or "running" + URLs
```

Or check: `flyctl logs` for real-time logs.

**Frontend (GitHub Pages):**
- Go to repo → **Deployments** tab
- Should show recent deployment to `gh-pages`
- URL: `https://<username>.github.io/<repo-name>`

## Important Config Notes

### Environment Variables

Backend may need env vars (e.g., `NODE_ENV=production`). Currently set in `fly.toml`:

```toml
[env]
NODE_ENV = "production"
PORT = "3000"
```

If you add more (e.g., API keys, auth), add them via:
```bash
flyctl secrets set MY_SECRET=value
```

### CORS & Socket.io

Frontend needs to connect to backend via WebSocket. The server currently allows `*` origin:

```javascript
cors: {
  origin: '*',  // TODO: restrict to your domain in production
  methods: ['GET', 'POST'],
}
```

Before production, update to:
```javascript
cors: {
  origin: 'https://yourdomain.com',
  methods: ['GET', 'POST'],
}
```

### Frontend API URL

Frontend currently connects to relative `/` (assumes backend serves frontend). For separate domains:
- Update `client.js`: `const socket = io('https://werewolf-game-prod.fly.dev');`
- Or set an env var in GitHub Pages build

## Troubleshooting

**Backend won't start:**
```bash
flyctl logs -a werewolf-game-prod
# Check for TypeScript compile errors or missing imports
```

**Socket.io connection refused:**
- Check CORS in server.ts
- Verify frontend is hitting correct backend URL
- Check Fly.io firewall (should allow port 3000, but it's internal)

**GitHub Actions failing:**
- Go to Actions tab → click failed workflow
- Check logs for npm/tsc errors
- Common: missing `FLY_API_TOKEN` secret

**Frontend not updating:**
- GitHub Pages caches. Do a hard refresh (Cmd+Shift+R)
- Or clear browser cache

## Next Steps (Post-Deploy)

1. **Reconnection handling** — Handle player DC/rejoin (3-5k tokens)
2. **Custom domain** — Point `werewolf.example.com` to Fly.io + GitHub Pages
3. **Monitoring** — Add error tracking (Sentry, LogRocket)
4. **Additional roles** — Witch, Hunter, Sheriff (2-3k tokens each)
5. **Mobile polish** — Touch-friendly UI, responsive chat

## Quick Reference

| Component | Platform | URL | Notes |
|-----------|----------|-----|-------|
| Backend | Fly.io | `https://werewolf-game-prod.fly.dev` | Generated on `flyctl launch` |
| Frontend | GitHub Pages | `https://username.github.io/werewolfware` | Auto-deploy on `main` push |
| Code Repo | GitHub | `https://github.com/...` | Source of truth |

## Emergency Rollback

If deployment breaks:
```bash
# Fly.io: revert to last working release
flyctl releases
flyctl releases rollback <version-number>

# GitHub Pages: revert main branch commit
git revert <commit-hash>
git push origin main
```

---

**Ready to deploy?** Start at **Setup Step 1** above with a `flyctl` terminal session.
