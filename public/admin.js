// ---------- state ----------
let state = {
  hostName: null,
  phase: null,
  phaseEndsAt: null,
  players: [],   // includes role for admin
};

const socket = io({ auth: { isAdmin: true } });

// ---------- screen helpers ----------
function show(id) {
  ['screen-setup', 'screen-lobby', 'screen-game', 'screen-ended'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function log(text) {
  const el = document.getElementById('event-log');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.textContent = text;
  el.prepend(div);
}

// ---------- setup ----------
document.getElementById('day-slider').addEventListener('input', e => {
  document.getElementById('day-label').textContent = e.target.value + 's';
});
document.getElementById('night-slider').addEventListener('input', e => {
  document.getElementById('night-label').textContent = e.target.value + 's';
});

document.getElementById('btn-create').addEventListener('click', () => {
  const hostName = document.getElementById('host-name').value.trim();
  if (!hostName) {
    document.getElementById('setup-error').textContent = 'Enter your name.';
    document.getElementById('setup-error').classList.remove('hidden');
    return;
  }
  state.hostName = hostName;
  socket.emit('game:create', {
    hostName,
    dayDuration: parseInt(document.getElementById('day-slider').value) * 1000,
    nightDuration: parseInt(document.getElementById('night-slider').value) * 1000,
  });
});

// ---------- lobby ----------

document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('game:start');
});

document.getElementById('lobby-day-slider').addEventListener('input', e => {
  document.getElementById('lobby-day-label').textContent = e.target.value + 's';
  emitTimers();
});
document.getElementById('lobby-night-slider').addEventListener('input', e => {
  document.getElementById('lobby-night-label').textContent = e.target.value + 's';
  emitTimers();
});

function emitTimers() {
  socket.emit('game:setTimers', {
    dayDuration: parseInt(document.getElementById('lobby-day-slider').value) * 1000,
    nightDuration: parseInt(document.getElementById('lobby-night-slider').value) * 1000,
  });
}

function renderLobbyPlayers(players) {
  document.getElementById('lobby-count').textContent = players.length;
  document.getElementById('lobby-player-list').innerHTML = players.map(p =>
    `<li>${escHtml(p.name)}${p.isHost ? ' <span class="badge host">HOST</span>' : ''}</li>`
  ).join('');
  const canStart = players.length >= 3;
  document.getElementById('btn-start').disabled = !canStart;
  document.getElementById('lobby-hint').textContent = canStart
    ? `${players.length} players ready.`
    : `Need at least ${3 - players.length} more player${3 - players.length !== 1 ? 's' : ''} to start.`;
}

// ---------- game ----------
document.getElementById('btn-advance').addEventListener('click', () => {
  socket.emit('game:advancePhase');
});

function renderPlayerGrid(players) {
  document.getElementById('player-grid').innerHTML = players.map(p => {
    const roleLabel = p.role === 'werewolf' ? '🐺 Werewolf' : p.role === 'villager' ? '👤 Villager' : '?';
    const statusClass = p.isAlive ? '' : 'player-card--dead';
    const roleClass = p.role ? `player-card--${p.role}` : '';
    return `<div class="player-card ${roleClass} ${statusClass}">
      <div class="player-card__name">${escHtml(p.name)}</div>
      <div class="player-card__role">${roleLabel}</div>
      <div class="player-card__status">${p.isAlive ? 'Alive' : '💀 Dead'}</div>
    </div>`;
  }).join('');
}

function applyPhaseUI(phase) {
  const badge = document.getElementById('admin-phase-badge');
  if (!badge) return;
  badge.textContent = phase === 'day' ? '☀️ Day' : '🌙 Night';
  badge.className = `phase-badge ${phase}`;
}

function startCountdown() {
  clearInterval(window._countdown);
  if (!state.phaseEndsAt) return;
  const tick = () => {
    const s = Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000));
    const el = document.getElementById('admin-phase-timer');
    if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  window._countdown = setInterval(tick, 500);
}

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

document.getElementById('btn-new-game').addEventListener('click', () => {
  state = { hostName: null, phase: null, phaseEndsAt: null, players: [] };
  show('screen-setup');
});

// ---------- socket events ----------
socket.on('game:created', () => {
  show('screen-lobby');
});

socket.on('game:state', snap => {
  state.phase = snap.phase;
  state.phaseEndsAt = snap.phaseEndsAt;
  state.players = snap.players;
});

socket.on('lobby:updated', ({ players }) => {
  state.players = players;
  renderLobbyPlayers(players);
});

socket.on('admin:state', snap => {
  state.players = snap.players;
  if (snap.phase === 'day' || snap.phase === 'night') {
    state.phase = snap.phase;
    state.phaseEndsAt = snap.phaseEndsAt;
    show('screen-game');
    applyPhaseUI(snap.phase);
    startCountdown();
    renderPlayerGrid(snap.players);
  }
});

socket.on('game:started', ({ phase, phaseEndsAt }) => {
  state.phase = phase;
  state.phaseEndsAt = phaseEndsAt;
  show('screen-game');
  applyPhaseUI(phase);
  startCountdown();
  renderPlayerGrid(state.players);
  log(`Game started. ${state.players.length} players.`);
});

socket.on('phase:changed', ({ phase, phaseEndsAt }) => {
  state.phase = phase;
  state.phaseEndsAt = phaseEndsAt;
  applyPhaseUI(phase);
  startCountdown();
  renderPlayerGrid(state.players);
  log(phase === 'day' ? '☀️ Day phase began.' : '🌙 Night phase began.');
});

socket.on('phase:tick', ({ secondsRemaining }) => {
  const el = document.getElementById('admin-phase-timer');
  if (el) el.textContent = `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, '0')}`;
});

socket.on('player:eliminated', ({ playerName, playerId, wasWerewolf, cause }) => {
  state.players = state.players.map(p => p.socketId === playerId ? { ...p, isAlive: false } : p);
  renderPlayerGrid(state.players);
  log(`${playerName} eliminated by ${cause}. Was ${wasWerewolf ? 'werewolf' : 'villager'}.`);
});

socket.on('vote:updated', ({ votes }) => {
  const el = document.getElementById('admin-vote-tally');
  if (el) el.textContent = votes.map(v => `${v.targetName}: ${v.count}`).join('  ·  ');
});

socket.on('vote:result', ({ eliminated, reason }) => {
  log(eliminated ? `Vote: ${eliminated.playerName} eliminated.` : `Vote: ${reason}`);
});

socket.on('night:result', ({ eliminated, reason }) => {
  log(eliminated ? `Night: ${eliminated.playerName} killed.` : `Night: ${reason}`);
});

socket.on('game:ended', showEndScreen);

socket.on('error', ({ message }) => {
  const el = document.getElementById('setup-error');
  if (el) { el.textContent = message; el.classList.remove('hidden'); }
});
