// Phone check: plays a 30-player game at phone size against the local copy that
// prepare.cjs builds, and checks each fix from Pass A (2026-11). Exits 1 on any failure.
// Numbers in the check names are the issue numbers in the design proposal.
// Run with:  npm test   (from tests/phone-check, after npm install)
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORK = path.join(__dirname, '.work');
const SHOTS = path.join(WORK, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass: !!pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`); };

function startServer(port, extraEnv = {}) {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: WORK, env: { ...process.env, PORT: String(port), ALLOW_TEST_ADMIN: '1', ...extraEnv } });
  const st = { exit: null, log: '' }; proc.on('exit', (c) => (st.exit = c));
  proc.stdout.on('data', (d) => (st.log += d)); proc.stderr.on('data', (d) => (st.log += d));
  return { proc, st };
}
async function waitUp(port) { for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) return true; } catch {} await sleep(250); } return false; }
async function adminDriver(port) {
  const a = io(`http://localhost:${port}/admin`, { transports: ['websocket'] });
  a.players = []; a.phase = 'lobby'; a.errors = []; a.votes = []; a.log = [];
  a.on('admin:view', (v) => { a.players = v.players; a.phase = v.phase; a.votes = v.votes; });
  a.on('admin:logEntry', (e) => a.log.push(e.text));
  a.on('error', (e) => a.errors.push(e.message));
  await new Promise((r) => a.on('connect', r));
  a.emit('admin:auth', { token: 'local-test' }); await sleep(250);
  return a;
}

async function main() {
  const browser = await chromium.launch();
  const phone = { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const join = async (BASE, name, vp = phone) => {
    const ctx = await browser.newContext(vp); const page = await ctx.newPage();
    page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
    await page.goto(BASE + '/index.html'); await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected);
    if (name) { await page.fill('#player-name', name); await page.tap('#join-submit'); await page.waitForSelector('#lobby-wait-screen:not(.hidden)'); }
    return page;
  };

  // ════════ Game 1: full 30-player game ════════
  const PORT = 3301, BASE = `http://localhost:${PORT}`;
  let { proc, st } = startServer(PORT); await waitUp(PORT);
  const admin = await adminDriver(PORT);
  admin.emit('admin:createGame'); await sleep(300);

  // Fix 4a: Advance Phase in the lobby is refused and the server survives
  admin.emit('admin:forcePhase'); await sleep(800);
  check('4a lobby Advance Phase: server still running', st.exit === null);
  check('4a lobby Advance Phase: moderator told why', admin.errors.some((e) => /Start the game first/.test(e)), admin.errors.slice(-1));

  const alex = await join(BASE, 'Alex'); const bri = await join(BASE, 'Bri'); const casey = await join(BASE, 'Casey');

  // Fix 1: no host buttons, and the events behind them do nothing
  check('1 no Start Game / Advance Phase buttons on a player phone', await alex.evaluate(() => !document.getElementById('start-game-btn') && !document.getElementById('advance-phase-btn') && !/Start Game|Advance Phase/.test(document.body.innerText)));
  const NAMES = ['Dana', 'Eli', 'Farah', 'Gus', 'Hana', 'Ivan', 'Jo', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tess', 'Uma', 'Vik', 'Wren', 'Xan', 'Yara', 'Zed', 'Bartholomew Montgome', 'Christopher-James', 'Di', 'Ed'];
  for (const n of NAMES) admin.emit('admin:addPlayer', { playerName: n });
  await sleep(600);
  check('setup: 30 players in the lobby', admin.players.length === 30, admin.players.length);
  await alex.evaluate(() => { socket.emit('game:start'); socket.emit('game:advancePhase'); socket.emit('lobby:create', { playerName: 'X' }); socket.emit('game:setMode', { modeId: 'x' }); }); await sleep(500);
  check('1 hand-sent start/advance/create from a player are ignored', admin.phase === 'lobby' && st.exit === null && admin.players.length === 30, { phase: admin.phase });

  // Fix 4b: events with no payload, and bad joins
  const raw = io(BASE, { transports: ['websocket'] }); const rawErr = []; raw.on('error', (e) => rawErr.push(e.message)); await new Promise((r) => raw.on('connect', r));
  for (const ev of ['lobby:join', 'vote:cast', 'night:action', 'chat:send', 'ghost:send', 'game:rejoin']) raw.emit(ev);
  raw.emit('lobby:join', { playerName: 'alex' }); raw.emit('lobby:join', { playerName: 'x'.repeat(21) }); raw.emit('lobby:join', { playerName: 42 });
  const rawAdmin = io(BASE + '/admin', { transports: ['websocket'] }); await new Promise((r) => rawAdmin.on('connect', r));
  for (const ev of ['admin:auth', 'admin:changeRole', 'admin:kick', 'admin:castVote', 'admin:addPlayer', 'admin:setTimer', 'admin:renamePlayer']) rawAdmin.emit(ev);
  await sleep(900); rawAdmin.close();
  check('4b events with no payload: server still running', st.exit === null, st.exit);
  // The lobby is full by now, so every join is refused as full. Name rules are in rules.cjs.
  check('4b bad joins to a full game are refused and nobody is added', admin.players.length === 30 && rawErr.filter((e) => /full/.test(e)).length === 4, rawErr); // three bad names plus one join with no payload

  // Fix 3: moderator page on phones and a portrait tablet
  const sizes = { '375x667': { width: 375, height: 667 }, '390x844': { width: 390, height: 844 }, '768x1024': { width: 768, height: 1024 } };
  const apages = {};
  for (const [label, vp] of Object.entries(sizes)) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const page = await ctx.newPage();
    page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
    await page.goto(BASE + '/admin.html'); await page.waitForSelector('#main-layout:not(.hidden)'); await sleep(400);
    apages[label] = { ctx, page, vp };
    const cdp = await ctx.newCDPSession(page);
    const before = await page.evaluate(() => Math.round(document.getElementById('start-game-btn').getBoundingClientRect().bottom));
    // finger drags, the way a thumb scrolls a list
    const x = Math.round(vp.width / 2), y0 = Math.round(vp.height * 0.8), y1 = Math.round(vp.height * 0.25);
    for (let n = 0; n < 8; n++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 12 }] }); await sleep(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(450);
    }
    const r = await page.evaluate(() => { const b = document.getElementById('start-game-btn'); const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { bottom: Math.round(r.bottom), top: Math.round(r.top), vh: innerHeight, hit: hit === b, rows: document.querySelectorAll('.player-card').length, lastRowVisible: (() => { const c = [...document.querySelectorAll('.player-card')].at(-1).getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight; })() }; });
    check(`3 moderator ${label}: Start Game reachable by touch scroll with 30 players`, before > vp.height && r.bottom <= r.vh && r.top >= 0 && r.hit, { before, after: r.bottom, vh: r.vh });
    check(`3 moderator ${label}: last player row reachable`, r.rows === 30 && r.lastRowVisible, { rows: r.rows });
    if (label === '375x667') await page.screenshot({ path: path.join(SHOTS, 'admin-lobby-scrolled.png') });
  }
  const A = apages['375x667'].page;
  // rider 15: log panel only under its own tab
  await A.tap('.tab-btn[data-tab="controls"]'); await sleep(200);
  check('15 log panel hidden under the Controls tab', await A.evaluate(() => getComputedStyle(document.getElementById('right-panel')).display === 'none'));
  await A.screenshot({ path: path.join(SHOTS, 'admin-controls.png') });
  // rider 12: errors visible (Advance Phase in the lobby, tapped on the real page)
  await A.tap('#advance-phase-btn'); await sleep(500);
  const banner = await A.evaluate(() => { const e = document.getElementById('admin-error'); const r = e.getBoundingClientRect(); return { text: e.textContent, visible: !e.classList.contains('hidden') && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight }; });
  check('12 moderator error is visible on screen', banner.visible && /Start the game first/.test(banner.text), banner);
  await A.screenshot({ path: path.join(SHOTS, 'admin-error-banner.png') });
  check('4a server still running after the real Advance Phase tap in the lobby', st.exit === null);
  await A.tap('.tab-btn[data-tab="log"]'); await sleep(200);
  check('log tab still fills the screen', await A.evaluate(() => { const l = document.getElementById('event-log').getBoundingClientRect(); return l.height > 300 && document.querySelectorAll('.log-entry').length > 0; }));
  await A.tap('.tab-btn[data-tab="players"]');

  // ── Start ──
  admin.emit('admin:startGame'); await sleep(700);
  check('game starts from the moderator', admin.phase === 'night' && (await alex.evaluate(() => !document.getElementById('game-screen').classList.contains('hidden'))));
  const idOf = (n) => admin.players.find((p) => p.name === n || p.name === 'Mayor ' + n)?.id;
  const nameOnPhone = (n) => admin.players.find((p) => p.name === n || p.name === 'Mayor ' + n)?.name;

  // Fix 4c: late joiner
  const late = await join(BASE, null); await late.fill('#player-name', 'Latecomer'); await late.tap('#join-submit'); await sleep(500);
  check('4c late joiner is turned away with a message', admin.players.length === 30 && (await late.evaluate(() => /already started/.test(document.getElementById('error-message').textContent))), await late.evaluate(() => document.getElementById('error-message').textContent));

  // ── Day ──
  admin.emit('admin:forcePhase'); await sleep(700);
  check('advance works once the game has started', admin.phase === 'day');
  const voteFor = async (page, name) => { await page.locator('#vote-list .player-card', { hasText: new RegExp('^' + name) }).first().tap(); await sleep(300); };
  const alive = () => admin.players.filter((p) => p.alive).map((p) => p.name);
  const pickTarget = (...not) => alive().find((n) => !not.includes(n) && !/Alex|Bri|Casey/.test(n));
  const t1 = pickTarget(); await voteFor(casey, t1);

  // bonus: timer change keeps the highlight and counts
  admin.emit('admin:setTimer', { seconds: 120 }); await sleep(400);
  const afterTimer = await casey.evaluate(() => ({ selected: [...document.querySelectorAll('#vote-list .player-card.selected')].map((c) => c.firstChild.textContent), badges: [...document.querySelectorAll('.vote-count-badge')].filter((b) => b.textContent).length }));
  check('7 timer change keeps the vote highlight (vote counts stay hidden)', afterTimer.selected.length === 1 && afterTimer.selected[0] === t1 && afterTimer.badges === 0, afterTimer);

  // Fix 2: connection drops and repairs itself, no refresh
  const briOld = idOf('Bri');
  await bri.evaluate(() => socket.io.engine.close());
  await bri.waitForFunction(() => socket.connected, null, { timeout: 15000 }); await sleep(900);
  const briNew = idOf('Bri');
  // Pass B: a player's id is fixed when they join, so a reconnect does not change it
  check('2 after a dropped connection the phone keeps the same player id', briNew && briNew === briOld && (await bri.evaluate(() => view.you.id)) === briNew, { briOld, briNew });
  check('2 the drop and the return are noted for the moderator', admin.log.some((l) => /Bri lost connection/.test(l)) && admin.log.some((l) => /Bri reconnected/.test(l)));
  check('2 moderator sees the player as connected again', admin.players.find((p) => p.id === briNew)?.connected === true);
  const t2 = pickTarget(t1); await voteFor(bri, t2);
  check('2 the reconnected phone can vote without a refresh', admin.votes.some((v) => v.voterId === briNew && v.targetName === t2) && (await bri.evaluate(() => document.getElementById('error-screen').classList.contains('hidden') || !/Not in a room/.test(document.getElementById('error-message').textContent))), admin.votes.filter((v) => v.voterId === briNew));
  // another phone votes FOR the reconnected player: its card must carry the new id
  await voteFor(alex, nameOnPhone('Bri'));
  check('2 other phones can still vote for the reconnected player', admin.votes.some((v) => v.targetId === briNew && v.targetName !== 'Unknown'), admin.votes.filter((v) => /Bri/.test(v.targetName)));
  check('2 Casey keeps her highlight through someone else reconnecting; no counts shown', await casey.evaluate((t) => { const sel = [...document.querySelectorAll('#vote-list .player-card.selected')].map((c) => c.firstChild.textContent); return sel.length === 1 && sel[0] === t && [...document.querySelectorAll('.vote-count-badge')].filter((b) => b.textContent).length === 0; }, t1));
  check('4 phones receive no one else\'s votes', await casey.evaluate(() => !('votes' in view) && !JSON.stringify(view).includes('voterId')));
  check('10 a player is not in their own vote list', await casey.evaluate(() => ![...document.querySelectorAll('#vote-list .player-card')].some((c) => c.dataset.playerId === gameState.playerId)));
  // drop detection while offline
  await bri.evaluate(() => { socket.io.opts.reconnection = false; socket.io.engine.close(); });
  // Wait for the server to notice (up to 5 seconds) rather than a fixed pause, so a slow CI machine does not fail it
  const briOffline = () => admin.players.find((p) => /Bri/.test(p.name))?.connected === false;
  for (let i = 0; i < 50 && !briOffline(); i++) await sleep(100);
  check('2 a phone that stays offline shows as disconnected to the moderator', briOffline());
  const caseySeesIt = await casey.waitForFunction(() => /Bri.*\(disconnected\)/.test(document.getElementById('game-players-ul').innerText), null, { timeout: 5000 }).then(() => true, () => false);
  check('2 other phones mark that player as disconnected', caseySeesIt);
  await bri.reload(); await bri.waitForSelector('#game-screen:not(.hidden)', { timeout: 8000 }); await sleep(600);
  check('2 a refresh returns to the game with the right name and no join form', await bri.evaluate(() => /Bri/.test(document.getElementById('nameplate-name').textContent) && document.getElementById('lobby-screen').classList.contains('hidden') && gameState.phase === 'day'), await bri.evaluate(() => document.getElementById('nameplate-name').textContent));

  // Fix 5: remove a player mid-game
  const kicked = pickTarget(t1, t2); const kickedId = idOf(kicked);
  const aliveBefore = alive().length;
  admin.emit('admin:kick', { playerId: kickedId }); await sleep(600);
  const afterKick = await casey.evaluate(() => ({ cards: document.querySelectorAll('#vote-list .player-card').length, flagged: gameState.players.filter((p) => p.alive === true).length, total: gameState.players.length, selected: document.querySelectorAll('#vote-list .player-card.selected').length }));
  // The vote list shows every living player except the viewer
  check('5 after a mid-game removal the vote list is still full', afterKick.cards === aliveBefore - 2 && afterKick.flagged === aliveBefore - 1 && afterKick.selected === 1, { ...afterKick, expected: aliveBefore - 2 });
  await casey.screenshot({ path: path.join(SHOTS, 'player-day-after-kick.png') });

  // ghost screen after the removal
  admin.emit('admin:eliminate', { playerId: idOf('Casey') }); await sleep(3800);
  const ghost = await casey.evaluate(() => ({ alive: document.querySelectorAll('#ghost-alive-list li').length, dead: document.querySelectorAll('#ghost-dead-list li').length, shown: !document.getElementById('ghost-screen').classList.contains('hidden') }));
  check('5 ghost screen lists the living and the dead correctly', ghost.shown && ghost.alive === admin.players.filter((p) => p.alive).length && ghost.dead === admin.players.filter((p) => !p.alive).length, ghost);

  // Fix 6: end of game
  for (const p of admin.players.filter((p) => p.role.id === 'werewolf' && p.alive && !/Alex|Bri/.test(p.name))) admin.emit('admin:eliminate', { playerId: p.id });
  for (const n of ['Alex', 'Bri']) { const p = admin.players.find((x) => x.name.endsWith(n)); if (p.role.id === 'werewolf') admin.emit('admin:changeRole', { playerId: p.id, roleId: 'villager' }); }
  await sleep(500); alex.errors.length = 0; bri.errors.length = 0;
  admin.emit('admin:forcePhase'); await sleep(900);
  const end = await alex.evaluate(() => ({ title: document.getElementById('winner-title').textContent, cards: document.querySelectorAll('#results-grid .result-card').length, dayVisible: !document.getElementById('day-phase').classList.contains('hidden'), nightVisible: !document.getElementById('night-phase').classList.contains('hidden'), timer: document.getElementById('timer').textContent, phaseTitle: document.getElementById('phase-title').textContent, firstFate: document.querySelector('.result-fate')?.textContent }));
  check('6 end screen shows every player result on a living phone', admin.phase === 'ended' && end.cards === admin.players.length && end.cards > 0, end);
  check('6 end screen clears the phase panel and timer', !end.dayVisible && !end.nightVisible && end.timer === '' && end.phaseTitle === 'Game over', end);
  check('6 no page errors at the end', alex.errors.length === 0 && bri.errors.length === 0, { alex: alex.errors, bri: bri.errors });
  await alex.evaluate(() => scrollTo(0, 0)); await alex.screenshot({ path: path.join(SHOTS, 'player-end.png') });
  check('ghost phone also gets the result', await casey.evaluate(() => !document.getElementById('ghost-game-ended').classList.contains('hidden')));
  admin.emit('admin:forcePhase'); await sleep(400);
  check('advance after the end is refused, server running', st.exit === null && admin.errors.some((e) => /game is over/.test(e)));
  await alex.evaluate(() => { window.__marker = 1; document.getElementById('play-again-btn').scrollIntoView(); });
  await alex.tap('#play-again-btn'); await sleep(900);
  check('6 Return to Lobby works', await alex.evaluate(() => window.__marker !== 1 && !document.getElementById('lobby-screen').classList.contains('hidden')));
  check('no page errors on any phone or the moderator page', [alex, bri, casey, late, ...Object.values(apages).map((a) => a.page)].every((p) => p.errors.length === 0), { casey: casey.errors, admin: A.errors });

  // ════════ Game 2: removed player cannot return; server restart; token refresh ════════
  admin.emit('admin:endGame'); await sleep(400); admin.emit('admin:createGame'); await sleep(400);
  const dee = await join(BASE, 'Dee'); const max = await join(BASE, 'Max');
  for (const n of ['B1', 'B2', 'B3', 'B4']) admin.emit('admin:addPlayer', { playerName: n });
  await sleep(300); admin.emit('admin:startGame'); await sleep(500);
  admin.emit('admin:kick', { playerId: admin.players.find((p) => p.name.endsWith('Dee')).id }); await sleep(3600);
  check('5 a removed player is told, and lands back on the join screen', await dee.evaluate(() => !document.getElementById('lobby-screen').classList.contains('hidden') && !localStorage.getItem('werewolf_rejoin_token')));
  check('5 a removed player is not in the game any more', !admin.players.some((p) => p.name.endsWith('Dee')) && admin.players.length === 5);

  // rider 19: a fresh sign-in token on every connect (server restart forces a reconnect)
  const callsBefore = await A.evaluate(() => window.__tokenCalls);
  proc.kill(); await sleep(1500);
  ({ proc, st } = startServer(PORT)); await waitUp(PORT);
  await A.waitForFunction((n) => window.__tokenCalls > n, callsBefore, { timeout: 25000 }).catch(() => {}); await sleep(500);
  const callsAfter = await A.evaluate(() => window.__tokenCalls);
  check('19 moderator page asks for a fresh sign-in token on reconnect', callsBefore >= 1 && callsAfter === callsBefore + 1, { callsBefore, callsAfter });
  check('19 moderator page recovers after a server restart', await A.evaluate(() => !document.getElementById('no-game-panel').classList.contains('hidden')));
  let backAtJoin = false;
  for (let i = 0; i < 50 && !backAtJoin; i++) { await sleep(500); backAtJoin = await max.evaluate(() => typeof gameState !== 'undefined' && !gameState.playerId && !document.getElementById('lobby-screen').classList.contains('hidden') && document.getElementById('game-screen').classList.contains('hidden') && !localStorage.getItem('werewolf_rejoin_token')).catch(() => false); }
  check('2 after a server restart a phone returns to the join screen by itself', backAtJoin);

  // ════════ Game 3 (Pass B): a refresh at any point brings back the same screen ════════
  // Each phone's screen is reduced to a fingerprint of what is visible (except the
  // countdown), the page is reloaded, and the fingerprint must match. Hidden panels
  // are ignored: nobody sees them, and they are redrawn before they are shown.
  const mod = await adminDriver(PORT);
  mod.emit('admin:createGame'); await sleep(300);
  const fingerprint = (page) => page.evaluate(() => {
    const el = (id) => document.getElementById(id);
    const shown = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
    const vis = (id) => shown(el(id));
    const txt = (id) => (vis(id) ? el(id).textContent.replace(/\s+/g, ' ').trim() : '');
    const cards = (sel) => [...document.querySelectorAll(sel)].filter(shown).map((c) => c.textContent.trim() + (c.classList.contains('selected') ? ' [chosen]' : ''));
    return JSON.stringify({
      screen: ['lobby-screen', 'lobby-wait-screen', 'game-screen', 'ghost-screen'].filter(vis),
      waiting: txt('players-ul'),
      phase: txt('phase-title'), name: txt('nameplate-name'), roleTag: txt('nameplate-role'),
      role: txt('role-name'), pack: txt('role-pack'), notes: txt('role-notes'),
      panels: ['day-phase', 'night-phase', 'game-ended'].filter(vis), nightText: txt('night-instruction'),
      votes: cards('#vote-list .player-card'), targets: cards('#target-list .player-card'), players: txt('game-players-ul'),
      ghost: [txt('ghost-nameplate-name'), txt('ghost-phase-badge'), txt('ghost-alive-list'), txt('ghost-dead-list')],
      ghostEnded: vis('ghost-game-ended'), winner: txt('winner-title'), results: cards('#results-grid .result-card'),
    });
  });
  const refreshMatches = async (label, pages) => {
    const diffs = [];
    for (const [name, page] of Object.entries(pages)) {
      const before = await fingerprint(page);
      await page.reload();
      await page.waitForFunction(() => typeof view !== 'undefined' && view !== null, null, { timeout: 8000 }).catch(() => {});
      await sleep(400);
      const after = await fingerprint(page);
      if (before !== after) diffs.push({ name, before: JSON.parse(before), after: JSON.parse(after) });
    }
    check(`B refresh during ${label}: every phone comes back the same`, diffs.length === 0, diffs);
  };
  const rae = await join(BASE, 'Rae'); const sol = await join(BASE, 'Sol'); const tam = await join(BASE, 'Tam');
  for (const n of ['X1', 'X2', 'X3']) mod.emit('admin:addPlayer', { playerName: n });
  await sleep(400);
  await refreshMatches('the lobby', { rae, sol, tam });
  mod.emit('admin:startGame'); await sleep(400);
  const mid = (n) => mod.players.find((p) => p.name.replace(/^Mayor /, '') === n)?.id;
  for (const p of mod.players) mod.emit('admin:changeRole', { playerId: p.id, roleId: { Rae: 'seer', Sol: 'werewolf' }[p.name.replace(/^Mayor /, '')] || 'villager' });
  await sleep(400);
  await refreshMatches('night 1 before anyone chooses', { rae, sol, tam });
  check('B a role change shows on the phone without a refresh', (await rae.evaluate(() => document.getElementById('role-name').textContent)) === 'Seer' && (await rae.locator('#target-list .player-card').count()) > 0);
  await tam.screenshot({ path: path.join(SHOTS, 'night-villager-waiting.png') });
  check('B a villager waits at night (D5)', /Zzz/.test(await tam.evaluate(() => document.getElementById('night-instruction').textContent)) && (await tam.locator('#target-list .player-card').count()) === 0);
  await rae.locator('#target-list .player-card', { hasText: /^Sol$/ }).tap(); await sleep(250);
  await sol.locator('#target-list .player-card', { hasText: /^X1$/ }).tap(); await sleep(250);
  check('B a chosen target is marked', (await sol.locator('#target-list .player-card.selected').textContent()) === 'X1');
  await refreshMatches('night 1 after choices are made', { rae, sol, tam });
  mod.emit('admin:forcePhase'); await sleep(500);
  check('B the Seer\'s result is on the role card', /Night 1: Sol is on the WEREWOLF team/.test(await rae.evaluate(() => document.getElementById('role-notes').textContent)));
  await rae.screenshot({ path: path.join(SHOTS, 'day-seer-notes.png') });
  await tam.locator('#vote-list .player-card', { hasText: /^Sol$/ }).tap(); await sleep(250);
  await refreshMatches('day 1 with a vote cast and a Seer result', { rae, sol, tam });
  mod.emit('admin:eliminate', { playerId: mid('Tam') }); await sleep(3800);
  check('B an eliminated player reaches the ghost screen', await tam.evaluate(() => !document.getElementById('ghost-screen').classList.contains('hidden')));
  await refreshMatches('day 1 with a player dead', { rae, sol, tam });
  // Moderator panel reload mid-game: roles must show (they used to read as a dash)
  const M = apages['390x844'].page;
  await M.reload(); await M.waitForSelector('#main-layout:not(.hidden)'); await sleep(600);
  const pills = await M.evaluate(() => [...document.querySelectorAll('.role-pill')].map((e) => e.textContent));
  check('13 moderator reload mid-game shows every role', pills.length === 6 && !pills.includes('—') && pills.includes('Seer') && pills.includes('Werewolf'), pills);
  mod.emit('admin:eliminate', { playerId: mid('Sol') }); await sleep(3800); // Sol's death overlay plays first
  check('B the end screen shows on the living phones', await rae.evaluate(() => !document.getElementById('game-ended').classList.contains('hidden')));
  await refreshMatches('the end screen', { rae, sol, tam });
  for (const p of [rae, sol, tam]) check(`B no page errors on ${await p.evaluate(() => view && view.you.name)}`, p.errors.length === 0, p.errors);
  mod.close();
  proc.kill(); await sleep(500);

  // ════════ Test switch is refused on a deployed server ════════
  for (const [label, env] of [['NODE_ENV=production', { NODE_ENV: 'production' }], ['FLY_APP_NAME set', { FLY_APP_NAME: 'werewolfware' }], ['switch not set', { ALLOW_TEST_ADMIN: '' }]]) {
    const s2 = startServer(3302, env); await waitUp(3302);
    const a2 = io('http://localhost:3302/admin', { transports: ['websocket'] }); const errs = []; let authed = false;
    a2.on('error', (e) => errs.push(e.message)); a2.on('admin:authed', () => (authed = true));
    await new Promise((r) => a2.on('connect', r)); a2.emit('admin:auth', { token: 'local-test' }); await sleep(500);
    check(`test sign-in refused when ${label}`, !authed && errs.some((e) => /Unauthorized/.test(e)));
    a2.close(); s2.proc.kill(); await sleep(400);
  }

  await browser.close(); admin.close(); raw.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
  if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(' | ')); process.exit(1); }
}
main().then(() => process.exit(0)).catch((e) => { console.error('RUN FAILED', e); process.exit(2); });
