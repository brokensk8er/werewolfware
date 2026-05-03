// ---------- identity guard ----------
const params = new URLSearchParams(location.search);
const gameId = (params.get('game') || sessionStorage.getItem('ww_game') || '').toUpperCase();
const playerName = sessionStorage.getItem('ww_name');

if (!playerName || !gameId) {
  const dest = gameId ? `/join?game=${gameId}` : '/join';
  window.location.href = dest;
}

// Persist in case they arrived via URL param only
if (gameId) sessionStorage.setItem('ww_game', gameId);

// ---------- state ----------
let state = {
  gameId,
  myName: playerName,
  myRole: null,
  isAlive: true,
  phase: null,
  phaseEndsAt: null,
  players: [],
  myVote: null,
  myKillTarget: null,
};

// ---------- socket ----------
const socket = io({ auth: { playerName, gameId } });

// ---------- screen helpers ----------
function show(id) {
  ['screen-auth', 'screen-lobby', 'screen-role-reveal', 'screen-game', 'screen-ended'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showError(msg) {
  console.error('[werewolf]', msg);
  alert(msg);
}

// ---------- lobby ----------
function renderLobby(players) {
  document.getElementById('lobby-game-label').textContent = `Game: ${state.gameId}`;
  document.getElementById('lobby-count').textContent = players.length;
  document.getElementById('lobby-player-list').innerHTML = players.map(p =>
    `<li>${escHtml(p.name)}${p.isHost ? ' <span class="badge host">HOST</span>' : ''}</li>`
  ).join('');
}

// ---------- role reveal ----------
function showRoleReveal(role) {
  show('screen-role-reveal');
  const isWolf = role === 'werewolf';
  document.getElementById('role-reveal-icon').textContent = isWolf ? '🐺' : '👤';
  document.getElementById('role-reveal-title').textContent = isWolf ? 'You are a Werewolf' : 'You are a Villager';
  document.getElementById('role-reveal-flavor').textContent = isWolf
    ? 'Blend in. Deceive. Eliminate the villagers one by one.'
    : 'Trust your gut. Root out the wolves before they take over.';
  document.getElementById('role-reveal-card').className = `role-reveal-card role-reveal-card--${role}`;
}

document.getElementById('btn-enter-game').addEventListener('click', () => {
  show('screen-game');
  renderGame();
});

// ---------- game ----------
function renderGame() {
  const roleBadge = document.getElementById('my-role-badge');
  roleBadge.textContent = state.myRole === 'werewolf' ? '🐺 Werewolf' : '👤 Villager';
  roleBadge.className = `role-badge ${state.myRole}`;
  document.getElementById('my-name-label').textContent = state.myName;

  if (state.myRole === 'werewolf') document.getElementById('tab-wolf').classList.remove('hidden');
  if (!state.isAlive) document.getElementById('tab-dead').classList.remove('hidden');

  applyPhaseUI(state.phase);
  startCountdown();
  renderPlayerList();
  renderActionPanel();
}

function renderPlayerList() {
  document.getElementById('game-player-list').innerHTML = state.players.map(p =>
    `<li class="${p.isAlive ? '' : 'dead'}">${escHtml(p.name)}${p.isHost ? ' <span class="badge host">H</span>' : ''}</li>`
  ).join('');
}

function applyPhaseUI(phase) {
  const badge = document.getElementById('phase-badge');
  badge.textContent = phase === 'day' ? '☀️ Day' : '🌙 Night';
  badge.className = `phase-badge ${phase}`;
  state.myVote = null;
  state.myKillTarget = null;
}

function startCountdown() {
  clearInterval(window._countdown);
  if (!state.phaseEndsAt) return;
  const tick = () => {
    const s = Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000));
    document.getElementById('phase-timer').textContent = fmtTime(s);
  };
  tick();
  window._countdown = setInterval(tick, 500);
}

function fmtTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderActionPanel() {
  const els = ['panel-vote', 'panel-wolf-kill', 'panel-night-wait', 'panel-dead-wait'];
  els.forEach(id => document.getElementById(id).classList.add('hidden'));

  if (!state.isAlive) {
    document.getElementById('panel-dead-wait').classList.remove('hidden');
    return;
  }
  if (state.phase === 'day') {
    document.getElementById('panel-vote').classList.remove('hidden');
    renderVoteList();
  } else if (state.phase === 'night') {
    if (state.myRole === 'werewolf') {
      document.getElementById('panel-wolf-kill').classList.remove('hidden');
      renderKillList();
    } else {
      document.getElementById('panel-night-wait').classList.remove('hidden');
    }
  }
}

function renderVoteList() {
  const targets = state.players.filter(p => p.isAlive && p.socketId !== socket.id);
  document.getElementById('vote-list').innerHTML = targets.map(p =>
    `<li><button data-target="${p.socketId}" class="${state.myVote === p.socketId ? 'selected' : ''}">${escHtml(p.name)}</button></li>`
  ).join('');
}

function renderKillList() {
  const targets = state.players.filter(p => p.isAlive && p.role !== 'werewolf' && p.socketId !== socket.id);
  document.getElementById('kill-list').innerHTML = targets.map(p =>
    `<li><button data-target="${p.socketId}" class="${state.myKillTarget === p.socketId ? 'selected' : ''}">${escHtml(p.name)}</button></li>`
  ).join('');
}

// ---------- chat ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const room = btn.dataset.room;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.chat-panel').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
    btn.classList.add('active');
    const panel = document.getElementById(`chat-${room}`);
    panel.classList.add('active');
    panel.classList.remove('hidden');
  });
});

document.querySelectorAll('.btn-send').forEach(btn => {
  btn.addEventListener('click', () => sendChat(btn.dataset.room));
});
['main', 'dead', 'werewolf'].forEach(room => {
  document.getElementById(`input-${room}`)?.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(room); });
});

function sendChat(room) {
  const input = document.getElementById(`input-${room}`);
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat:send', { gameId: state.gameId, room, text });
  input.value = '';
}

function appendMsg(room, msg) {
  const el = document.getElementById(`messages-${room}`);
  if (!el) return;
  const div = document.createElement('div');
  div.className = msg.system ? 'msg system' : 'msg';
  if (msg.system) {
    div.textContent = msg.text;
  } else {
    div.innerHTML = `<span class="sender">${escHtml(msg.senderName)}:</span> <span class="text">${escHtml(msg.text)}</span>`;
  }
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

function loadHistory(messages) {
  ['main', 'dead', 'werewolf'].forEach(room => {
    const el = document.getElementById(`messages-${room}`);
    if (!el) return;
    el.innerHTML = '';
    (messages[room] || []).forEach(m => appendMsg(room, m));
  });
}

// ---------- vote / kill ----------
document.getElementById('vote-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-target]');
  if (!btn) return;
  state.myVote = btn.dataset.target;
  socket.emit('vote:cast', { gameId: state.gameId, targetId: btn.dataset.target });
  renderVoteList();
});

document.getElementById('kill-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-target]');
  if (!btn) return;
  state.myKillTarget = btn.dataset.target;
  socket.emit('werewolf:target', { gameId: state.gameId, targetId: btn.dataset.target });
  renderKillList();
});

// ---------- end screen ----------
function showEndScreen({ winner, roles }) {
  clearInterval(window._countdown);
  show('screen-ended');
  const banner = document.getElementById('winner-banner');
  banner.textContent = winner === 'villagers' ? '🏆 Villagers Win!' : '🐺 Werewolves Win!';
  banner.className = `winner-banner ${winner}`;
  document.getElementById('role-reveal-body').innerHTML = (roles || []).map(r =>
    `<tr>
      <td>${escHtml(r.name)}</td>
      <td class="${r.role}">${r.role === 'werewolf' ? '🐺 Werewolf' : '👤 Villager'}</td>
      <td class="${r.isAlive ? '' : 'dead'}">${r.isAlive ? 'Alive' : 'Dead'}</td>
    </tr>`
  ).join('');
}

// ---------- socket events ----------
socket.on('connect', () => {
  socket.emit('game:join', { gameId: state.gameId, playerName: state.myName });
});

socket.on('game:state', snap => {
  state.gameId = snap.gameId;
  state.myRole = snap.myRole;
  state.isAlive = snap.isAlive;
  state.phase = snap.phase;
  state.phaseEndsAt = snap.phaseEndsAt;
  state.players = snap.players;

  if (snap.phase === 'lobby') {
    show('screen-lobby');
    renderLobby(snap.players);
  } else if (snap.phase === 'day' || snap.phase === 'night') {
    loadHistory(snap.messages);
    if (document.getElementById('screen-game').classList.contains('hidden') &&
        document.getElementById('screen-role-reveal').classList.contains('hidden')) {
      show('screen-game');
      renderGame();
    } else {
      renderPlayerList();
      renderActionPanel();
    }
  } else if (snap.phase === 'ended') {
    showEndScreen(snap);
  }
});

socket.on('lobby:updated', ({ players }) => {
  state.players = players;
  renderLobby(players);
});

socket.on('game:started', ({ role, phase, phaseEndsAt }) => {
  state.myRole = role;
  state.phase = phase;
  state.phaseEndsAt = phaseEndsAt;
  state.isAlive = true;
  showRoleReveal(role);
});

socket.on('phase:changed', ({ phase, phaseEndsAt }) => {
  state.phase = phase;
  state.phaseEndsAt = phaseEndsAt;
  applyPhaseUI(phase);
  startCountdown();
  renderActionPanel();
  appendMsg('main', { system: true, text: phase === 'day' ? '☀️ Day phase begins. Discuss and vote!' : '🌙 Night falls. Stay quiet…' });
});

socket.on('phase:tick', ({ secondsRemaining }) => {
  document.getElementById('phase-timer').textContent = fmtTime(secondsRemaining);
});

socket.on('chat:message', msg => appendMsg(msg.room, msg));

socket.on('vote:updated', ({ votes }) => {
  const el = document.getElementById('vote-tally');
  el.textContent = votes.map(v => `${v.targetName}: ${v.count}`).join('  ·  ');
});

socket.on('player:eliminated', ({ playerName: pname, playerId, wasWerewolf, cause }) => {
  state.players = state.players.map(p => p.socketId === playerId ? { ...p, isAlive: false } : p);
  if (playerId === socket.id) {
    state.isAlive = false;
    document.getElementById('tab-dead').classList.remove('hidden');
    appendMsg('dead', { system: true, text: `You have been eliminated. Welcome to the afterlife.` });
  }
  renderPlayerList();
  renderActionPanel();
  const verb = cause === 'vote' ? 'voted out' : 'killed in the night';
  appendMsg('main', { system: true, text: `${pname} was ${verb}. They were a ${wasWerewolf ? 'Werewolf 🐺' : 'Villager 👤'}.` });
});

socket.on('vote:result', ({ eliminated, reason }) => {
  if (!eliminated) appendMsg('main', { system: true, text: `📢 ${reason}` });
});

socket.on('night:result', ({ eliminated, reason }) => {
  if (!eliminated) appendMsg('main', { system: true, text: `🌙 ${reason}` });
});

socket.on('werewolf:targetSelected', ({ byName, targetName }) => {
  appendMsg('werewolf', { system: true, text: `🎯 ${byName} selected ${targetName}.` });
});

socket.on('game:ended', showEndScreen);

socket.on('error', ({ message }) => showError(message));
