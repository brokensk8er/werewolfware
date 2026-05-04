# Live Deployment Testing Guide

## Deployment Status
- **Backend**: https://werewolfware.fly.dev
- **App Name**: werewolfware
- **Region**: ord (Chicago)
- **Status**: Recently deployed with Fly.io config fix (PORT=8080)

## What to Test

### 1. **Backend Health Check**
Test that the backend is responding to HTTP requests:
```bash
curl https://werewolfware.fly.dev/api/health
# Expected response: {"status":"ok"}
```

### 2. **Socket.io Connection**
Test WebSocket connectivity:
- Open a browser console at https://werewolfware.fly.dev
- Run: `socket = io(); socket.on('connect', () => console.log('Connected!'))`
- Expected: Connection message appears

### 3. **Game Creation Flow**
Using the web interface:
1. Navigate to https://werewolfware.fly.dev
2. Click "Create Game"
3. Enter a player name (e.g., "Player1")
4. Click "Create"
5. **Expected**: 
   - Room code is generated (6-character uppercase code)
   - Game switches to "Waiting for players" screen
   - Your name appears in the player list

### 4. **Game Joining Flow**
In a new browser tab/incognito:
1. Navigate to https://werewolfware.fly.dev
2. Click "Join Game"
3. Enter the room code from Step 3
4. Enter a different player name (e.g., "Player2")
5. Click "Join"
6. **Expected**:
   - Successfully joins the room
   - Player list updates in both browsers
   - "Start Game" button appears for the room creator

### 5. **Chat System**
While in the waiting room:
1. Player1 sends a message: "Hello from Player1"
2. Player2 sends a message: "Hello from Player2"
3. **Expected**:
   - Messages appear in real-time for both players
   - Messages are correctly attributed to sender
   - No XSS vulnerabilities (special characters handled safely)

### 6. **Game Mechanics**
1. Player1 clicks "Start Game"
2. **Expected**:
   - Game starts immediately
   - Both players see their assigned role (Werewolf or Villager)
   - Game advances to first phase (usually Night)
   - Phase title updates (e.g., "Night 1")

### 7. **Role Assignment Verification**
After game starts:
1. Each player should see a role card with:
   - Role name (Werewolf or Villager)
   - Role description
   - Win condition
2. At least one player should be assigned as Werewolf
3. At least one player should be assigned as Villager

### 8. **Night Phase**
When in night phase:
1. If you're a Werewolf, you should see a voting interface to select a target
2. If you're a Villager, you should see a message about it being night
3. The host can click "Advance Phase" (if host controls are visible)

### 9. **Day Phase**
When advancing to day phase:
1. Phase title changes to "Day X"
2. All players see voting interface
3. Players can vote to eliminate someone
4. Host can advance to next phase

### 10. **Chat During Game**
During gameplay:
1. Send messages in the chat
2. **Expected**:
   - Messages appear in real-time
   - Chat works during both day and night phases
   - Messages persist during phase transitions

## Automated Testing

A test script is available: `test-deployment.js`

### Prerequisites
```bash
npm install socket.io-client node-fetch
```

### Running the test
```bash
# From repo root
BACKEND_URL=https://werewolfware.fly.dev node test-deployment.js
```

The script will:
- ✓ Test backend health check
- ✓ Test Socket.io connection
- ✓ Test game creation and joining
- ✓ Test role assignment
- ✓ Test phase advancement
- ✓ Test chat functionality

## Monitoring Fly.io Logs

### View logs in real-time
```bash
flyctl logs -a werewolfware
```

### Check app status
```bash
flyctl status -a werewolfware
```

### Check specific machine
```bash
flyctl machines list -a werewolfware
```

## Key Issues to Watch For

### 1. **Port Mismatch Error**
If you see: `Port 3000 refused` or similar
- **Cause**: PORT env var not set
- **Solution**: Fixed in latest commit (PORT=8080)

### 2. **CORS Errors**
If Socket.io fails to connect from a different domain:
- **Cause**: Frontend and backend on different domains
- **Solution**: Update `cors.origin` in server.ts or set frontend URL

### 3. **WebSocket Connection Failed**
If console shows: `WebSocket is closed before the connection is established`
- **Cause**: Backend not responding
- **Solution**: Check `flyctl logs -a werewolfware` for errors

### 4. **Game State Not Syncing**
If player lists or messages don't update in real-time:
- **Cause**: Socket.io connection issues
- **Solution**: Check browser console for JavaScript errors

## Expected Performance

- **Connection time**: < 2 seconds
- **Message latency**: < 500ms
- **Phase advancement**: Instant
- **Concurrent players**: 50+ (with shared-cpu-1x VM)

## Rollback Plan

If deployment has critical errors:

```bash
# View recent releases
flyctl releases -a werewolfware

# Rollback to previous version
flyctl releases rollback -a werewolfware
```

## Next Steps After Testing

1. **Confirm all tests pass** ✓
2. **Check Fly.io logs for errors** 
3. **Monitor for 24 hours** in production
4. **Gather user feedback**
5. **Plan improvements** (custom domain, monitoring, additional roles)

## Configuration Details

### Current Fly.io Configuration
- **App**: werewolfware
- **Region**: ord (Chicago)
- **VM**: Shared CPU, 1x, 256MB RAM
- **PORT**: 8080 (via environment variable)
- **AUTO_STOP_MACHINES**: Enabled (scales to zero when idle)

### Frontend Details
- **Type**: Static HTML/CSS/JS
- **Deployment**: Via GitHub Pages (future)
- **Socket.io**: Connected via `io()` (relative path)

### Backend Details
- **Type**: Express.js + Socket.io (TypeScript)
- **Framework**: Express 4.18
- **Socket.io**: 4.7.2
- **Language**: TypeScript (compiled to ESM)

## Success Criteria

- ✓ Backend responds to health checks
- ✓ WebSocket connections establish successfully
- ✓ Players can create games
- ✓ Players can join games by room code
- ✓ Chat messages sync in real-time
- ✓ Roles are assigned correctly
- ✓ Phases advance without errors
- ✓ No errors in Fly.io logs
- ✓ Multiple concurrent games possible

---

**Need help?** Check the project README or DEPLOYMENT.md for more details.
