const socket = io();

// ---------- state ----------
let state = {
  gameId: null,
  myName: null,
  myRole: null,
  isHost: false,
  isAlive: true,
  phase: null,
  phaseEndsAt: null,
  players: [],
  myVote: null,
  myKillTarget: null,
};

// ---------- screen helpers ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === id);
    s.classList.toggle('hidden', s.id !== id);
  });
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ---------- landing ----------
document.getElementById('btn-create-game').addEventListener('click', () => showScreen('screen-host-setup'));
document.getElementById('btn-show-join').addEventListener('click', () => {
  document.getElementById('join-form').classList.toggle('hidden');
});

document.getElementById('btn-join-submit').addEventListener('click', submitJoin);
document.getElementById('join-player-name').addEventListener('keydown', e => { if (e.key === 'Enter') submitJoin(); });

function submitJoin() {
  const gameId = document.getElementById('join-game-id').value.trim().toUpperCase();
  const playerName = document.getElementById('join-player-name').value.trim();
  if (!gameId || !playerName) return showError('landing-error', 'Enter a game ID and your name.');
  socket.emit('game:join', { gameId, playerName });
}

// ---------- host setup ----------
const daySlider = document.getElementById('day-slider');
const nightSlider = document.getElementById('night-slider');
daySlider.addEventListener('input', () => { document.getElementById('day-label').textContent = daySlider.value + 's'; });
nightSlider.addEventListener('input', () => { document.getElementById('night-label').textContent = nightSlider.value + 's'; });

document.getElementById('btn-confirm-create').addEventListener('click', () => {
  const hostName = document.getElementById('host-name').value.trim();
  if (!hostName) return showError('setup-error', 'Enter your name.');
  socket.emit('game:create', {
    hostName,
    dayDuration: parseInt(daySlider.value) * 1000,
    nightDuration: parseInt(nightSlider.value) * 1000,
  });
});

// ---------- host lobby ----------
document.getElementById('btn-copy-url').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('join-url-text').textContent);
  document.getElementById('btn-copy-url').textContent = 'Copied!';
  setTimeout(() => { document.getElementById('btn-copy-url').textContent = 'Copy'; }, 2000);
});

document.getElementById('btn-start-game').addEventListener('click', () => {
  socket.emit('game:start', { gameId: state.gameId });
});

const lobbyDaySlider = document.getElementById('lobby-day-slider');
const lobbyNightSlider = document.getElementById('lobby-night-slider');
lobbyDaySlider.addEventListener('input', () => {
  document.getElementById('lobby-day-label').textContent = lobbyDaySlider.value + 's';
  socket.emit('game:setTimers', { gameId: state.gameId, dayDuration: parseInt(lobbyDaySlider.value) * 1000, nightDuration: parseInt(lobbyNightSlider.value) * 1000 });
});
lobbyNightSlider.addEventListener('input', () => {
  document.getElementById('lobby-night-label').textContent = lobbyNightSlider.value + 's';
  socket.emit('game:setTimers', { gameId: state.gameId, dayDuration: parseInt(lobbyDaySlider.value) * 1000, nightDuration: parseInt(lobbyNightSlider.value) * 1000 });
});

// ---------- game header ----------
document.getElementById('btn-advance-phase').addEventListener('click', () => {
  socket.emit('game:advancePhase', { gameId: state.gameId });
});

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
  const input = document.getElementById(`input-${room}`);
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(room); });
});

function sendChat(room) {
  const input = document.getElementById(`input-${room}`);
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat:send', { gameId: state.gameId, room, text });
  input.value = '';
}

function appendMessage(room, msg) {
  const container = document.getElementById(`messages-${room}`);
  if (!container) return;
  const div = document.createElement('div');
  div.classList.add('msg');
  if (msg.system) {
    div.classList.add('system');
    div.textContent = msg.text;
  } else {
    div.innerHTML = `<span class="sender">${escHtml(msg.senderName)}:</span><span class="text"> ${escHtml(msg.text)}</span>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendSystemMessage(room, text) {
  appendMessage(room, { system: true, text });
}

// ---------- voting ----------
document.getElementById('vote-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-target]');
  if (!btn) return;
  const targetId = btn.dataset.target;
  state.myVote = targetId;
  socket.emit('vote:cast', { gameId: state.gameId, targetId });
  document.querySelectorAll('#vote-list button').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
});

document.getElementById('kill-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-target]');
  if (!btn) return;
  const targetId = btn.dataset.target;
  state.myKillTarget = targetId;
  socket.emit('werewolf:target', { gameId: state.gameId, targetId });
  document.querySelectorAll('#kill-list button').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
});

// ---------- ended ----------
document.getElementById('btn-play-again').addEventListener('click', () => {
  state = { gameId: null, myName: null, myRole: null, isHost: false, isAlive: true, phase: null, phaseEndsAt: null, players: [], myVote: null, myKillTarget: null };
  showScreen('screen-landing');
});

// ---------- rendering ----------
function renderLobbyPlayers(players, listId, countId) {
  const list = document.getElementById(listId);
  const count = document.getElementById(countId);
  list.innerHTML = players.map(p =>
    `<li>${escHtml(p.name)} ${p.isHost ? '<span class="badge host">HOST</span>' : ''}</li>`
  ).join('');
  if (count) count.textContent = players.length;
}

function renderGamePlayers() {
  const list = document.getElementById('game-player-list');
  list.innerHTML = state.players.map(p => {
    const dead = !p.isAlive;
    return `<li class="${dead ? 'dead' : ''}">${escHtml(p.name)}${p.isHost ? ' <span class="badge host">H</span>' : ''}</li>`;
  }).join('');
}

function renderVoteList() {
  const list = document.getElementById('vote-list');
  const targets = state.players.filter(p => p.isAlive && p.socketId !== socket.id);
  list.innerHTML = targets.map(p =>
    `<li><button data-target="${p.socketId}" class="${state.myVote === p.socketId ? 'selected' : ''}">${escHtml(p.name)}</button></li>`
  ).join('');
}

function renderKillList() {
  const list = document.getElementById('kill-list');
  const targets = state.players.filter(p => p.isAlive && p.role !== 'werewolf' && p.socketId !== socket.id);
  list.innerHTML = targets.map(p =>
    `<li><button data-target="${p.socketId}" class="${state.myKillTarget === p.socketId ? 'selected' : ''}">${escHtml(p.name)}</button></li>`
  ).join('');
}

function renderActionPanel() {
  const panelVote = document.getElementById('panel-vote');
  const panelKill = document.getElementById('panel-wolf-kill');
  const panelWait = document.getElementById('panel-night-wait');
  [panelVote, panelKill, panelWait].forEach(p => p.classList.add('hidden'));

  if (!state.isAlive) return;

  if (state.phase === 'day') {
    panelVote.classList.remove('hidden');
    renderVoteList();
  } else if (state.phase === 'night') {
    if (state.myRole === 'werewolf') {
      panelKill.classList.remove('hidden');
      renderKillList();
    } else {
      panelWait.classList.remove('hidden');
    }
  }
}

function applyPhaseUI(phase) {
  const badge = document.getElementById('phase-badge');
  badge.textContent = phase === 'day' ? '☀️ Day' : '🌙 Night';
  badge.className = `phase-badge ${phase}`;
  state.myVote = null;
  state.myKillTarget = null;
}

function startCountdown() {
  clearInterval(window._countdownInterval);
  if (!state.phaseEndsAt) return;
  function tick() {
    const remaining = Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000));
    document.getElementById('phase-timer').textContent = formatTime(remaining);
  }
  tick();
  window._countdownInterval = setInterval(tick, 500);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function loadMessageHistory(messages) {
  ['main', 'dead', 'werewolf'].forEach(room => {
    const container = document.getElementById(`messages-${room}`);
    if (!container) return;
    container.innerHTML = '';
    if (messages[room]) messages[room].forEach(msg => appendMessage(room, msg));
  });
}

// ---------- socket events ----------
socket.on('game:created', ({ gameId, qrDataUrl, joinUrl }) => {
  state.gameId = gameId;
  document.getElementById('lobby-game-id').textContent = gameId;
  document.getElementById('qr-code').src = qrDataUrl;
  document.getElementById('join-url-text').textContent = joinUrl;
  showScreen('screen-host-lobby');
});

socket.on('game:state', (snapshot) => {
  state.gameId = snapshot.gameId;
  state.myName = snapshot.myName;
  state.myRole = snapshot.myRole;
  state.isHost = snapshot.isHost;
  state.isAlive = snapshot.isAlive;
  state.phase = snapshot.phase;
  state.phaseEndsAt = snapshot.phaseEndsAt;
  state.players = snapshot.players;

  if (snapshot.phase === 'lobby') {
    if (state.isHost) {
      document.getElementById('lobby-game-id').textContent = snapshot.gameId;
      lobbyDaySlider.value = snapshot.dayDuration / 1000;
      lobbyNightSlider.value = snapshot.nightDuration / 1000;
      document.getElementById('lobby-day-label').textContent = (snapshot.dayDuration / 1000) + 's';
      document.getElementById('lobby-night-label').textContent = (snapshot.nightDuration / 1000) + 's';
      renderLobbyPlayers(snapshot.players, 'lobby-player-list', 'lobby-count');
      updateStartButton(snapshot.players.length);
    } else {
      document.getElementById('player-lobby-game-id').textContent = snapshot.gameId;
      renderLobbyPlayers(snapshot.players, 'player-lobby-list', 'player-lobby-count');
      showScreen('screen-player-lobby');
    }
  } else if (snapshot.phase === 'day' || snapshot.phase === 'night') {
    enterGameScreen(snapshot);
    loadMessageHistory(snapshot.messages);
  } else if (snapshot.phase === 'ended') {
    showEndScreen(snapshot);
  }
});

socket.on('lobby:updated', ({ players }) => {
  state.players = players;
  if (state.isHost) {
    renderLobbyPlayers(players, 'lobby-player-list', 'lobby-count');
    updateStartButton(players.length);
  } else {
    renderLobbyPlayers(players, 'player-lobby-list', 'player-lobby-count');
  }
});

socket.on('game:started', ({ role, phase, phaseEndsAt }) => {
  state.myRole = role;
  state.phase = phase;
  state.phaseEndsAt = phaseEndsAt;
  state.isAlive = true;
  enterGameScreen(state);
});

socket.on('phase:changed', ({ phase, phaseEndsAt }) => {
  state.phase = phase;
  state.phaseEndsAt = phaseEndsAt;
  applyPhaseUI(phase);
  startCountdown();
  renderActionPanel();
  appendSystemMessage('main', phase === 'day' ? '☀️ Day phase begins. Discuss and vote!' : '🌙 Night falls. Stay quiet…');
});

socket.on('phase:tick', ({ secondsRemaining }) => {
  document.getElementById('phase-timer').textContent = formatTime(secondsRemaining);
});

socket.on('chat:message', (msg) => {
  appendMessage(msg.room, msg);
});

socket.on('vote:updated', ({ votes }) => {
  const tally = document.getElementById('vote-tally');
  if (!votes.length) { tally.textContent = ''; return; }
  tally.textContent = votes.map(v => `${v.targetName}: ${v.count} vote${v.count !== 1 ? 's' : ''}`).join('  |  ');
});

socket.on('vote:result', ({ eliminated, reason }) => {
  if (eliminated) {
    appendSystemMessage('main', `📢 The village voted out ${eliminated.playerName}! They were a ${eliminated.wasWerewolf ? 'Werewolf 🐺' : 'Villager 👤'}.`);
  } else {
    appendSystemMessage('main', `📢 ${reason}`);
  }
});

socket.on('night:result', ({ eliminated, reason }) => {
  if (eliminated) {
    appendSystemMessage('main', `🌙 At dawn, ${eliminated.playerName} was found dead. They were a ${eliminated.wasWerewolf ? 'Werewolf 🐺' : 'Villager 👤'}.`);
  } else {
    appendSystemMessage('main', `🌙 ${reason}`);
  }
});

socket.on('player:eliminated', ({ playerName, playerId, wasWerewolf, cause }) => {
  state.players = state.players.map(p =>
    p.socketId === playerId ? { ...p, isAlive: false } : p
  );
  if (playerId === socket.id) {
    state.isAlive = false;
    document.getElementById('tab-dead').classList.remove('hidden');
    appendSystemMessage('dead', `You died. Welcome to the afterlife, ${playerName}.`);
  }
  renderGamePlayers();
  renderActionPanel();

  if (cause === 'vote') {
    appendSystemMessage('main', `🗳️ ${playerName} was eliminated by vote. They were a ${wasWerewolf ? 'Werewolf 🐺' : 'Villager 👤'}.`);
  } else {
    appendSystemMessage('main', `🌙 ${playerName} was killed in the night. They were a ${wasWerewolf ? 'Werewolf 🐺' : 'Villager 👤'}.`);
  }
});

socket.on('werewolf:targetSelected', ({ byName, targetName }) => {
  appendSystemMessage('werewolf', `🎯 ${byName} selected ${targetName} as the target.`);
});

socket.on('game:ended', ({ winner, roles }) => {
  showEndScreen({ winner, roles });
});

socket.on('error', ({ message }) => {
  console.warn('[server error]', message);
  showError('landing-error', message);
});

// ---------- helpers ----------
function updateStartButton(count) {
  const btn = document.getElementById('btn-start-game');
  btn.disabled = count < 3;
  btn.textContent = count < 3 ? `Start Game (need ${3 - count} more)` : 'Start Game';
}

function enterGameScreen(snapshot) {
  showScreen('screen-game');
  state.players = snapshot.players || state.players;

  const roleBadge = document.getElementById('my-role-badge');
  roleBadge.textContent = state.myRole === 'werewolf' ? '🐺 Werewolf' : '👤 Villager';
  roleBadge.className = `role-badge ${state.myRole}`;

  const advBtn = document.getElementById('btn-advance-phase');
  if (state.isHost) advBtn.classList.remove('hidden');

  if (state.myRole === 'werewolf') {
    document.getElementById('tab-wolf').classList.remove('hidden');
  }
  if (!state.isAlive) {
    document.getElementById('tab-dead').classList.remove('hidden');
  }

  applyPhaseUI(state.phase);
  startCountdown();
  renderGamePlayers();
  renderActionPanel();
}

function showEndScreen({ winner, roles }) {
  clearInterval(window._countdownInterval);
  showScreen('screen-ended');
  const banner = document.getElementById('winner-banner');
  banner.textContent = winner === 'villagers' ? '🏆 Villagers Win!' : '🐺 Werewolves Win!';
  banner.className = `winner-banner ${winner}`;

  const tbody = document.getElementById('role-reveal-body');
  tbody.innerHTML = (roles || []).map(r =>
    `<tr>
      <td>${escHtml(r.name)}</td>
      <td class="${r.role}">${r.role === 'werewolf' ? '🐺 Werewolf' : '👤 Villager'}</td>
      <td class="${r.isAlive ? '' : 'dead'}">${r.isAlive ? 'Alive' : 'Dead'}</td>
    </tr>`
  ).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- auto-join from URL ----------
(function checkUrlJoin() {
  const params = new URLSearchParams(window.location.search);
  const joinId = params.get('join');
  if (joinId) {
    document.getElementById('join-game-id').value = joinId.toUpperCase();
    document.getElementById('join-form').classList.remove('hidden');
    document.getElementById('join-player-name').focus();
  }
})();
