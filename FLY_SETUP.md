# Fly.io Launch & Deployment Setup

This guide walks you through launching the Werewolf game on Fly.io.

## Prerequisites

1. **Fly.io account** - Create one at https://fly.io (free tier available)
2. **flyctl CLI** - Install from https://fly.io/docs/hands-on/install-flyctl/
3. **Git repo** - Already cloned locally

## Step 1: Authenticate with Fly.io

```bash
flyctl auth login
# This opens a browser for you to authenticate
```

## Step 2: Launch the App

Navigate to the backend directory:
```bash
cd backend
```

Run the launch command:
```bash
flyctl launch
```

You'll be prompted with questions:

| Question | Answer |
|----------|--------|
| "Choose an app name:" | `werewolfware` (or custom name) |
| "Choose a region:" | `ord` (Chicago) or your preference |
| "Would you like to copy its configuration...?" | `Yes` |
| "Would you like to set up a Postgresql database?" | `No` |
| "Would you like to set up a Redis database?" | `No` |
| "Deploy now?" | **`No`** (we'll deploy via GitHub Actions) |

This creates the app on Fly.io and updates `fly.toml`.

## Step 3: Generate API Token for GitHub Actions

```bash
flyctl auth token
```

Copy the output token.

## Step 4: Add Token to GitHub

1. Go to your GitHub repo
2. **Settings → Secrets and variables → Actions**
3. Click **New repository secret**
4. **Name:** `FLY_API_TOKEN`
5. **Value:** Paste the token from Step 3
6. Click **Save**

## Step 5: Trigger Deployment

Push changes to main (which will trigger the GitHub Actions workflow):

```bash
git push origin main
```

## Step 6: Monitor Deployment

Watch the deployment in real-time:

```bash
# View live logs
flyctl logs -a werewolfware

# Check app status
flyctl status -a werewolfware

# List running machines
flyctl machines list -a werewolfware
```

## Step 7: Access Your App

Once deployed, your app will be at:
```
https://werewolfware.fly.dev
```

(Or your custom app name if you chose a different one)

## Troubleshooting

### "Address already in use" error
```bash
# Kill any existing flyctl processes
pkill -f flyctl
```

### "Authentication required"
```bash
# Re-authenticate
flyctl auth login
```

### Check what went wrong
```bash
# View detailed logs
flyctl logs -a werewolfware

# Check recent releases
flyctl releases -a werewolfware
```

## Next Steps After Launch

1. **Test the deployment** - Visit https://werewolfware.fly.dev
2. **Run local tests** - Use `npm start` in backend directory for local testing
3. **Monitor logs** - Watch for any runtime errors
4. **Set up custom domain** (optional) - Point your domain to Fly.io

---

**Ready?** Run `flyctl auth login` first, then follow the steps above!
