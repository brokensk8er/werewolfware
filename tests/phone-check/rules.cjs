// Rules check: drives games through plain socket connections (no browser) and checks
// each game rule. Runs against the local copy that prepare.cjs builds. Exits 1 on any failure.
// Decisions referred to below are recorded in TODO.md.
const { io } = require('socket.io-client');
const { spawn } = require('node:child_process');
const path = require('node:path');

const WORK = path.join(__dirname, '.work');
const PORT = 3401;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined && !pass ? '  ' + JSON.stringify(detail) : ''}`);
};

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
  cwd: WORK,
  env: { ...process.env, PORT: String(PORT), ALLOW_TEST_ADMIN: '1' },
});
let serverExit = null;
server.on('exit', (c) => (serverExit = c));

// ── Moderator connection ────────────────────────────────────────────────────
const admin = {
  players: [], phase: 'lobby', errors: [], log: [], clearLogs: 0, phaseSeconds: null,
};
function attachAdmin(sock) {
  sock.on('admin:view', (v) => { admin.players = v.players; admin.phase = v.phase; admin.phaseSeconds = v.secondsRemaining; });
  sock.on('admin:state', (d) => { admin.log = d.log.map((e) => e.text); });
  sock.on('admin:logEntry', (e) => admin.log.push(e.text));
  sock.on('admin:clearLog', () => admin.clearLogs++);
  sock.on('admin:noGame', () => { admin.phase = 'none'; admin.players = []; });
  sock.on('error', (e) => admin.errors.push(e.message));
}
const lastError = () => admin.errors.at(-1) || '';
const base = (n) => n.replace(/^Mayor /, '');
const idOf = (name) => admin.players.find((p) => base(p.name) === name)?.id;
const pl = (name) => admin.players.find((p) => base(p.name) === name);
const dead = () => admin.players.filter((p) => !p.alive).map((p) => base(p.name));

// ── Player connections (plain sockets standing in for phones) ───────────────
async function phone(name) {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  s.got = [];
  s.onAny((ev, data) => s.got.push([ev, data]));
  await new Promise((r) => s.on('connect', r));
  s.emit('lobby:join', { playerName: name });
  await sleep(150);
  return s;
}
const events = (s, ev) => s.got.filter(([e]) => e === ev).map(([, d]) => d);
const lastView = (s) => events(s, 'game:view').at(-1);
const errorsOf = (s) => events(s, 'error').map((d) => d.message);

let A; // admin socket
const sockets = [];
async function newGame(total, phoneNames = []) {
  if (admin.phase !== 'none') { A.emit('admin:endGame'); await sleep(200); }
  A.emit('admin:createGame'); await sleep(200);
  const phones = {};
  for (const n of phoneNames) { phones[n] = await phone(n); sockets.push(phones[n]); }
  for (let i = phoneNames.length; i < total; i++) A.emit('admin:addPlayer', { playerName: `B${i}` });
  await sleep(300);
  return phones;
}
async function start() { A.emit('admin:startGame'); await sleep(300); }
// Give named players exact roles; everyone else becomes a villager.
async function setRoles(map) {
  for (const p of admin.players) A.emit('admin:changeRole', { playerId: p.id, roleId: map[base(p.name)] || 'villager' });
  await sleep(300);
}
async function advance() { A.emit('admin:forcePhase'); await sleep(350); }
const act = async (actor, target) => { A.emit('admin:submitNightAction', { actorId: idOf(actor), targetId: idOf(target) }); await sleep(80); };
const vote = async (voter, target) => { A.emit('admin:castVote', { voterId: idOf(voter), targetId: idOf(target) }); await sleep(80); };

async function main() {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(250); }
  A = io(`${BASE}/admin`, { transports: ['websocket'] });
  attachAdmin(A);
  await new Promise((r) => A.on('connect', r));
  A.emit('admin:auth', { token: 'local-test' }); await sleep(250);

  // ═══ Lobby: names, tokens, cap, role mix (decision 6) ═══
  let ph = await newGame(1, ['Alex']);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  check('rejoin token is a random UUID', uuid.test(events(ph.Alex, 'session')[0]?.token || ''));
  check('player id is a random UUID, not the connection id', uuid.test(events(ph.Alex, 'session')[0]?.playerId || '') && events(ph.Alex, 'session')[0].playerId !== ph.Alex.id);
  check('a phone gets its view on joining', lastView(ph.Alex)?.phase === 'lobby' && lastView(ph.Alex)?.you.name === 'Alex' && lastView(ph.Alex)?.you.role === null);
  const odd = await phone('alex'); sockets.push(odd);
  const num = io(BASE, { transports: ['websocket'], reconnection: false }); num.got = []; num.onAny((e, d) => num.got.push([e, d])); sockets.push(num);
  await new Promise((r) => num.on('connect', r));
  num.emit('lobby:join', { playerName: 42 }); num.emit('lobby:join', { playerName: '   ' }); num.emit('lobby:join', { playerName: 'x'.repeat(21) });
  await sleep(250);
  check('duplicate name refused, case-insensitive', errorsOf(odd).some((m) => /taken/.test(m)));
  check('names must be text of 1 to 20 characters', errorsOf(num).filter((m) => /1 to 20/.test(m)).length === 3, errorsOf(num));
  A.emit('admin:changeRole', { playerId: idOf('Alex'), roleId: 'seer' }); await sleep(150);
  check('Change Role refused in the lobby', /dealt when the game starts/.test(lastError()), lastError());
  for (let i = 1; i < 30; i++) A.emit('admin:addPlayer', { playerName: `B${i}` });
  await sleep(400);
  A.emit('admin:addPlayer', { playerName: 'Extra' }); await sleep(150);
  const late = await phone('Thirtyone'); sockets.push(late);
  check('the cap is 30 players: the 31st is refused', admin.players.length === 30 && /full \(30/.test(lastError()) && errorsOf(late).some((m) => /full/.test(m)), { n: admin.players.length, err: lastError() });
  A.emit('admin:setTimer', { seconds: 0 }); await sleep(100);
  const e1 = lastError();
  A.emit('admin:setTimer', { seconds: 'abc' }); await sleep(100);
  check('timer must be 5 seconds to 60 minutes', /between 5 seconds/.test(e1) && /between 5 seconds/.test(lastError()));
  await start();
  const wolvesAt = (n) => admin.players.filter((p) => p.role?.id === 'werewolf').length;
  check('30 players are dealt 5 werewolves (about 1 in 6)', wolvesAt() === 5, wolvesAt());
  check('night uses the default 30-second timer', admin.phaseSeconds === 30, admin.phaseSeconds);
  for (const [n, want] of [[12, 2], [5, 1], [20, 3]]) {
    await newGame(n); await start();
    check(`${n} players are dealt ${want} werewol${want > 1 ? 'ves' : 'f'}`, wolvesAt() === want, wolvesAt());
  }

  // ═══ Night: one pack kill, targets checked (decision D2) ═══
  ph = await newGame(12, ['Sera', 'Vic']);
  await start();
  await setRoles({ W1: 'werewolf', W2: 'werewolf', W3: 'werewolf', Sera: 'seer', Doc: 'doctor' });
  // bots are named B2..B11; give three of them wolf names for readability
  A.emit('admin:renamePlayer', { playerId: admin.players[2].id, newName: 'W1' });
  A.emit('admin:renamePlayer', { playerId: admin.players[3].id, newName: 'W2' });
  A.emit('admin:renamePlayer', { playerId: admin.players[4].id, newName: 'W3' });
  A.emit('admin:renamePlayer', { playerId: admin.players[5].id, newName: 'Doc' });
  await sleep(250);
  await setRoles({ W1: 'werewolf', W2: 'werewolf', W3: 'werewolf', Sera: 'seer', Doc: 'doctor' });
  A.emit('admin:renamePlayer', { playerId: idOf('W1'), newName: 'w2' }); await sleep(120);
  check('rename refuses a name already in use', /taken/.test(lastError()), lastError());

  await act('W1', 'W2');
  check('a werewolf cannot target the pack', /own pack/.test(lastError()), lastError());
  await act('W1', 'W1');
  check('a werewolf cannot target itself', /cannot choose yourself/.test(lastError()), lastError());
  const before = admin.errors.length;
  await act('Doc', 'Doc');
  check('the Doctor may protect themselves', admin.errors.length === before, admin.errors.slice(before));
  await vote('Vic', 'W1');
  check('no votes at night', /only open during the day/.test(lastError()), lastError());
  await act('W1', 'B6'); await act('W2', 'B6'); await act('W3', 'B7');
  ph.Sera.emit('night:action', { targetId: idOf('W1') }); await sleep(150);
  await advance();
  check('three werewolves kill one player: the one most of them chose', JSON.stringify(dead()) === JSON.stringify(['B6']), dead());
  const seen = lastView(ph.Sera)?.you.notes.at(-1);
  check('the Seer learns the team, not the role (decision 5)', seen && seen.at === 'Night 1' && seen.text === 'W1 is on the WEREWOLF team.', seen);
  check('the Seer\'s message names the team', events(ph.Sera, 'chat:message').some((m) => /W1 is on the WEREWOLF team/.test(m.text)));
  check('day uses the default 60-second timer', admin.phase === 'day' && admin.phaseSeconds === 60, { phase: admin.phase, s: admin.phaseSeconds });

  // ═══ Day: checks, hidden votes, Mayor, ties (decisions 4 and D3) ═══
  await vote('B6', 'W1');
  check('dead players cannot vote', /Only living players/.test(lastError()), lastError());
  await vote('Vic', 'B6');
  check('nobody can vote for a dead player', /cannot be voted for/.test(lastError()), lastError());
  await vote('Vic', 'Vic');
  check('nobody can vote for themselves', /yourself/.test(lastError()), lastError());
  await act('W1', 'Vic');
  check('no night actions by day', /only open at night/.test(lastError()), lastError());

  ph.Vic.got.length = 0;
  ph.Vic.emit('vote:cast', { targetId: idOf('W2') }); await sleep(150);
  check('a phone\'s view shows its own recorded vote', lastView(ph.Vic)?.you.voteId === idOf('W2'));
  await vote('Vic', 'W3');
  check('a vote the moderator casts shows on that player\'s phone', lastView(ph.Vic)?.you.voteId === idOf('W3'));
  check('the moderator sees who has voted', pl('Vic')?.acted === true && pl('B9')?.acted === false);
  await vote('Sera', 'W1'); await vote('Doc', 'W1');
  const viewsJson = JSON.stringify([...events(ph.Vic, 'game:view'), ...events(ph.Sera, 'game:view')]);
  check('phones never receive who voted for whom (decision 4)', !viewsJson.includes('voterId') && lastView(ph.Sera)?.you.voteId === idOf('W1'));
  // tally now: W3 1 (Vic), W1 2 (Sera, Doc); add one for W3 to tie at 2-2
  await vote('B7', 'W3');
  await advance();
  check('a tied vote eliminates nobody (D3)', dead().length === 1 && admin.log.some((t) => /tied between/.test(t) && /No one is eliminated/.test(t)), { dead: dead(), log: admin.log.slice(-3) });
  check('night 2 is 30 seconds again (the day\'s 60 no longer carries over)', admin.phase === 'night' && admin.phaseSeconds === 30, { phase: admin.phase, s: admin.phaseSeconds });

  // ═══ Pass B: refresh and reconnect restore everything; role changes redraw at once ═══
  const seraToken = events(ph.Sera, 'session')[0].token;
  const seraId = events(ph.Sera, 'session')[0].playerId;
  const seraNotes = JSON.stringify(lastView(ph.Sera).you.notes);
  ph.Sera.close(); await sleep(300);
  check('a phone that closes shows as offline to the moderator', pl('Sera')?.connected === false);
  const sera2 = io(BASE, { transports: ['websocket'], reconnection: false }); sera2.got = []; sera2.onAny((e, d) => sera2.got.push([e, d])); sockets.push(sera2);
  await new Promise((r) => sera2.on('connect', r));
  sera2.emit('game:rejoin', { token: seraToken }); await sleep(250);
  const v2 = lastView(sera2);
  check('after a refresh the phone is the same player, with role and notes restored', v2?.you.id === seraId && v2.you.role?.id === 'seer' && JSON.stringify(v2.you.notes) === seraNotes && v2.phase === 'night', v2 && { id: v2.you.id === seraId, role: v2.you.role?.id, notes: v2.you.notes });
  check('after a refresh the phone gets the recent chat, announcements included', (events(sera2, 'chat:history')[0]?.messages || []).some((m) => /tied between/.test(m.text)));
  check('the moderator sees the refreshed phone as connected again', pl('Sera')?.connected === true);
  ph.Sera = sera2;
  A.emit('admin:changeRole', { playerId: idOf('Vic'), roleId: 'seer' }); await sleep(200);
  const vv = lastView(ph.Vic);
  check('a role change mid-night reaches the phone at once', vv?.you.role?.id === 'seer' && vv.you.role.hasNightAction === true && vv.phase === 'night', vv?.you.role);
  A.emit('admin:changeRole', { playerId: idOf('Vic'), roleId: 'villager' }); await sleep(150);

  // Mayor counts twice: Mayor -> W1 (2 votes) beats one villager -> W2 (1 vote)
  await advance(); // the tie moved the game to night; no actions, so back to day
  A.emit('admin:changeRole', { playerId: idOf('B8'), roleId: 'mayor' }); await sleep(150);
  check('a new Mayor gets the title in their name', pl('B8')?.name === 'Mayor B8', pl('B8')?.name);
  await vote('B8', 'W1'); await vote('B9', 'W2');
  await advance();
  check('the Mayor\'s vote counts twice', pl('W1') && !pl('W1').alive && pl('W2').alive, dead());

  // ═══ Chat limits ═══
  ph.Vic.got.length = 0;
  ph.Vic.emit('chat:send', { text: 'y'.repeat(301) }); await sleep(100);
  ph.Vic.emit('chat:send', { text: 'first' }); ph.Vic.emit('chat:send', { text: 'second' }); await sleep(150);
  const vErr = errorsOf(ph.Vic);
  check('chat is limited to 300 characters', vErr.some((m) => /300 characters/.test(m)), vErr);
  check('chat is limited to one message a second', vErr.some((m) => /one message a second/.test(m)), vErr);
  A.emit('admin:eliminate', { playerId: idOf('Sera') }); await sleep(200);
  ph.Sera.got.length = 0;
  ph.Sera.emit('chat:send', { text: 'boo' }); await sleep(150);
  check('the dead cannot use town chat', errorsOf(ph.Sera).some((m) => /ghost chat/.test(m)));

  // ═══ Moderator eliminations decide the game; the log is kept ═══
  const clearsBefore = admin.clearLogs;
  for (const w of ['W2', 'W3']) A.emit('admin:eliminate', { playerId: idOf(w) });
  await sleep(400);
  const ended = lastView(ph.Vic)?.ended;
  check('eliminating the last werewolf ends the game', admin.phase === 'ended' && lastView(ph.Vic)?.phase === 'ended' && ended?.winner === 'village', { phase: admin.phase, ended });
  check('the moderator\'s log is kept at the end', admin.clearLogs === clearsBefore && admin.log.length > 10, { clears: admin.clearLogs - clearsBefore, n: admin.log.length });
  A.emit('admin:changeRole', { playerId: idOf('Vic'), roleId: 'seer' }); await sleep(120);
  check('Change Role refused after the end', /game is over/.test(lastError()), lastError());
  A.emit('admin:endGame'); await sleep(200);
  A.emit('admin:createGame'); await sleep(250);
  check('a new game starts with a fresh log', admin.log.length < 5, admin.log.length);

  // ═══ End Game by the moderator (no winner) ═══
  ph = await newGame(6, ['Pat']);
  await start();
  A.emit('admin:endGame'); await sleep(300);
  const e = lastView(ph.Pat)?.ended;
  check('End Game says the moderator ended it, not a village win', e && e.winner === 'none' && e.endedByModerator === true && e.players.length === 6, e);

  // ═══ Werewolves see their pack (D6); nobody else learns roles ═══
  ph = await newGame(6, ['Wa', 'Wb', 'Vc']);
  await start();
  await setRoles({ Wa: 'werewolf', Wb: 'werewolf' });
  const wa = lastView(ph.Wa), vc = lastView(ph.Vc);
  check('nobody keeps the Mayor title after a role change', admin.players.every((p) => !p.name.startsWith('Mayor ')), admin.players.map((p) => p.name));
  check('a werewolf\'s view names the rest of the pack', JSON.stringify(wa?.you.pack) === '["Wb"]', wa?.you.pack);
  check('a villager\'s view names no pack and no one else\'s role', vc?.you.pack.length === 0 && !JSON.stringify(vc).includes('"team":"werewolf"') && vc.players.every((p) => Object.keys(p).sort().join() === 'alive,connected,id,name'), vc?.you.pack);

  // ═══ Server survived everything ═══
  check('server still running', serverExit === null);

  for (const s of sockets) s.close();
  A.close();
  server.kill();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length} of ${results.length} rule checks passed`);
  if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(' | ')); process.exit(1); }
}

main().then(() => process.exit(0)).catch((err) => { console.error('RUN FAILED', err); server.kill(); process.exit(2); });
