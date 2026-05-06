// Utility to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Socket.io client
const socket = io('https://werewolfware.fly.dev');

let rejoinPending = false;

socket.on('connect', () => {
  const token = localStorage.getItem('werewolf_rejoin_token');
  if (token && !gameState.playerId) {
    rejoinPending = true;
    socket.emit('game:rejoin', { token });
  }
});

// Game state
let gameState = {
  roomCode: null,
  playerId: null,
  playerName: null,
  role: null,
  players: [],
  phase: 'lobby',
  isHost: false,
  isDead: false,
};

let timerInterval = null;

// DOM elements
const lobbyScreen = document.getElementById('lobby-screen');
const lobbyWaitScreen = document.getElementById('lobby-wait-screen');
const gameScreen = document.getElementById('game-screen');
const errorAlert = document.getElementById('error-screen');

const joinForm = document.getElementById('join-form');
const playerName = document.getElementById('player-name');
const joinSubmit = document.getElementById('join-submit');

const playersUl = document.getElementById('players-ul');
const gamePlayersUl = document.getElementById('game-players-ul');
const gameControlsDiv = document.getElementById('game-controls');
const startGameBtn = document.getElementById('start-game-btn');

const phaseTitle = document.getElementById('phase-title');
const timer = document.getElementById('timer');
const roleCard = document.getElementById('role-card');
const roleName = document.getElementById('role-name');
const roleDescription = document.getElementById('role-description');

const dayPhaseDiv = document.getElementById('day-phase');
const nightPhaseDiv = document.getElementById('night-phase');
const gameEndedDiv = document.getElementById('game-ended');
const nightInstruction = document.getElementById('night-instruction');

const voteList = document.getElementById('vote-list');
const targetList = document.getElementById('target-list');

const hostControls = document.getElementById('host-controls');
const advancePhaseBtn = document.getElementById('advance-phase-btn');
advancePhaseBtn.addEventListener('click', () => {
  socket.emit('game:advancePhase');
});

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

// Ghost screen elements
const deathOverlay     = document.getElementById('death-overlay');
const ghostScreen      = document.getElementById('ghost-screen');
const ghostNameName    = document.getElementById('ghost-nameplate-name');
const ghostNameRole    = document.getElementById('ghost-nameplate-role');
const ghostPhaseBadge  = document.getElementById('ghost-phase-badge');
const ghostAliveList   = document.getElementById('ghost-alive-list');
const ghostDeadList    = document.getElementById('ghost-dead-list');
const ghostMessages    = document.getElementById('ghost-messages');
const ghostInput       = document.getElementById('ghost-input');
const ghostSendBtn     = document.getElementById('ghost-send-btn');
const ghostGameEnded   = document.getElementById('ghost-game-ended');
const ghostWinnerTitle = document.getElementById('ghost-winner-title');
const ghostWinReason   = document.getElementById('ghost-win-reason');
const ghostPlayAgain   = document.getElementById('ghost-play-again-btn');
chatSendBtn.addEventListener('click', () => {
  if (!chatInput.value.trim()) return;
  socket.emit('chat:send', { text: chatInput.value });
  chatInput.value = '';
});

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') chatSendBtn.click();
});

// Event listeners
joinSubmit.addEventListener('click', () => {
  const name = playerName.value.trim();
  if (!name) {
    showError('Please enter your name');
    return;
  }
  gameState.playerName = name;
  socket.emit('lobby:join', { playerName: name });
  playerName.value = '';
});

playerName.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinSubmit.click();
});

startGameBtn.addEventListener('click', () => {
  socket.emit('game:start');
});

// Socket.io event handlers
socket.on('lobby:joined', (data) => {
  gameState.roomCode = data.roomCode;
  gameState.playerId = data.playerId;
  if (data.token) localStorage.setItem('werewolf_rejoin_token', data.token);
  showLobbyWait();
});

socket.on('lobby:created', (data) => {
  gameState.roomCode = data.roomCode;
  gameState.playerId = data.playerId;
  if (data.token) localStorage.setItem('werewolf_rejoin_token', data.token);
  showLobbyWait();
});

socket.on('lobby:updated', (data) => {
  gameState.players = data.players;
  updatePlayerList();

  // Show start button only for host if min players met
  if (gameState.isHost && data.players.length >= 5) {
    gameControlsDiv.classList.remove('hidden');
  }
});

socket.on('game:started', (data) => {
  gameState.role = data.role;
  gameState.players = data.players;
  showGameScreen();
  updateRoleCard();
  updateGamePlayerList();
  document.getElementById('nameplate-name').textContent = gameState.playerName || 'You';
  document.getElementById('nameplate-role').textContent = data.role?.name || '';
});

socket.on('game:reconnected', (data) => {
  rejoinPending = false;
  gameState.playerId = data.playerId;
  gameState.role = data.role;
  gameState.players = data.players;
  gameState.phase = data.phase;

  const me = data.players.find((p) => p.id === data.playerId);
  gameState.isDead = me ? !me.alive : false;

  if (gameState.isDead) {
    // Rejoin straight to ghost screen — no death overlay on reconnect
    showGhostScreen();
  } else {
    showGameScreen();
    updateRoleCard();
    updateGamePlayerList();
    document.getElementById('nameplate-name').textContent = gameState.playerName || 'You';
    document.getElementById('nameplate-role').textContent = data.role?.name || '';
    data.recentMessages.forEach((msg) => appendChatMessage(msg));
    updatePhaseDisplay(data.phase, data.secondsRemaining);
  }
});

socket.on('player:connectionChanged', (data) => {
  gameState.players = gameState.players.map((p) =>
    p.id === data.playerId ? { ...p, connected: data.connected } : p
  );
  if (gameState.isDead) {
    updateGhostPlayerLists();
  } else {
    updateGamePlayerList();
  }
});

socket.on('phase:changed', (data) => {
  gameState.phase = data.phase;
  if (gameState.isDead) {
    updateGhostPhaseBadge(data.phase);
  } else {
    updatePhaseDisplay(data.phase, data.secondsRemaining);
  }
});

socket.on('player:eliminated', (data) => {
  gameState.players = gameState.players.map((p) =>
    p.id === data.playerId ? { ...p, alive: false } : p
  );

  if (data.playerId === gameState.playerId) {
    // This player just died
    gameState.isDead = true;
    showDeathOverlay(() => showGhostScreen());
  } else {
    showError(`${data.playerName} (${data.role}) was eliminated!`);
    if (gameState.isDead) {
      updateGhostPlayerLists();
    } else {
      updateGamePlayerList();
    }
  }
});

socket.on('seer:investigation', (data) => {
  // Only seers see this
  showError(`You investigated: ${data.targetName} is a ${data.role}`);
});

socket.on('night:actionRecorded', (data) => {
  const target = gameState.players.find((p) => p.id === data.targetId);
  showError(`Action recorded on ${target?.name}`);
});

socket.on('vote:updated', (data) => {
  const voteMap = new Map();
  for (const vote of data.votes) {
    voteMap.set(vote.targetId, (voteMap.get(vote.targetId) || 0) + 1);
  }
  // Only touch the count badge — never rewrite the card's name or structure
  document.querySelectorAll('#vote-list .player-card').forEach((card) => {
    const count = voteMap.get(card.dataset.playerId) || 0;
    const badge = card.querySelector('.vote-count-badge');
    if (badge) badge.textContent = count > 0 ? ` (${count} vote${count !== 1 ? 's' : ''})` : '';
  });
});

socket.on('vote:result', (data) => {
  showError(`${data.eliminatedName} was voted out with ${data.voteCount} votes!`);
});

socket.on('chat:message', (data) => {
  appendChatMessage(data);
});

socket.on('game:ended', (data) => {
  localStorage.removeItem('werewolf_rejoin_token');
  if (gameState.isDead) {
    ghostGameEnded.classList.remove('hidden');
    ghostWinnerTitle.textContent = `${data.winner.toUpperCase()} WINS!`;
    ghostWinReason.textContent = data.winReason;
  } else {
    showGameEnded(data.winner, data.winReason);
  }
});

socket.on('ghost:message', (data) => {
  appendGhostMessage(data);
});

socket.on('error', (data) => {
  if (rejoinPending) {
    rejoinPending = false;
    localStorage.removeItem('werewolf_rejoin_token');
  }
  showError(data.message);
});

// Helper functions
function showError(message) {
  const errorMessage = document.getElementById('error-message');
  errorMessage.textContent = message;
  errorAlert.classList.remove('hidden');
  setTimeout(() => {
    errorAlert.classList.add('hidden');
  }, 5000);
}

function showLobbyWait() {
  lobbyScreen.classList.add('hidden');
  lobbyWaitScreen.classList.remove('hidden');
}

function showGameScreen() {
  lobbyWaitScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

function updatePlayerList() {
  playersUl.innerHTML = '';
  gameState.players.forEach((player) => {
    const li = document.createElement('li');
    li.textContent = player.name;
    playersUl.appendChild(li);
  });
}

function updateGamePlayerList() {
  gamePlayersUl.innerHTML = '';
  gameState.players.forEach((player) => {
    const li = document.createElement('li');
    li.textContent = player.name;
    if (!player.alive) li.style.opacity = '0.4';
    if (player.connected === false) li.textContent += ' (disconnected)';
    gamePlayersUl.appendChild(li);
  });
}

function appendChatMessage(data) {
  const msgEl = document.createElement('div');
  const isSystem = data.senderId === '__system__';
  msgEl.className = isSystem ? 'chat-message chat-system' : 'chat-message';
  msgEl.innerHTML = `<strong>${escapeHtml(data.senderName)}:</strong> ${escapeHtml(data.text)}`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateRoleCard() {
  if (!gameState.role) return;
  roleName.textContent = gameState.role.name;
  roleDescription.textContent = gameState.role.description;
}

function updatePhaseDisplay(phase, secondsRemaining) {
  dayPhaseDiv.classList.add('hidden');
  nightPhaseDiv.classList.add('hidden');
  gameEndedDiv.classList.add('hidden');

  // Show host controls only during active game phases
  if (gameState.isHost && phase !== 'ended') {
    hostControls.classList.remove('hidden');
  } else {
    hostControls.classList.add('hidden');
  }

  phaseTitle.textContent = phase === 'day' ? '☀️ Day' : '🌙 Night';

  if (phase === 'day') {
    dayPhaseDiv.classList.remove('hidden');
    renderVoteList();
  } else if (phase === 'night') {
    nightPhaseDiv.classList.remove('hidden');
    if (gameState.role && gameState.role.hasNightAction) {
      nightInstruction.textContent = 'Choose your target...';
      renderTargetList();
    } else {
      nightInstruction.textContent = 'Waiting for night actions...';
    }
  }

  startTimer(secondsRemaining);
}

function startTimer(seconds) {
  clearInterval(timerInterval);
  let remaining = seconds;
  timer.textContent = `${remaining}s`;
  timerInterval = setInterval(() => {
    remaining--;
    timer.textContent = `${remaining}s`;
    if (remaining <= 0) clearInterval(timerInterval);
  }, 1000);
}

function attachFilterBar(searchId, countId, barId, gridId) {
  const searchInput = document.getElementById(searchId);
  const countLabel  = document.getElementById(countId);
  const filterBar   = document.getElementById(barId);
  const cards       = document.querySelectorAll(`#${gridId} .player-card`);
  const total       = cards.length;

  filterBar.classList.toggle('vote-filter-bar--visible', total > 12);
  countLabel.textContent = String(total);
  searchInput.value = '';

  searchInput.oninput = () => {
    const q = searchInput.value.toLowerCase().trim();
    let visible = 0;
    cards.forEach((card) => {
      const name = card.querySelector('span')?.textContent.toLowerCase() ?? '';
      const show = !q || name.includes(q);
      card.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    countLabel.textContent = q ? `${visible}/${total}` : String(total);
  };
}

function renderVoteList() {
  voteList.innerHTML = '';
  gameState.players.forEach((player) => {
    if (!player.alive) return;
    const card = document.createElement('div');
    card.className = 'player-card alive';
    card.dataset.playerId = player.id;

    const nameEl = document.createElement('span');
    nameEl.textContent = player.name;
    const badge = document.createElement('small');
    badge.className = 'vote-count-badge';
    card.append(nameEl, badge);

    card.addEventListener('click', () => {
      document.querySelectorAll('#vote-list .player-card').forEach((c) => c.classList.remove('selected'));
      socket.emit('vote:cast', { targetId: player.id });
      card.classList.add('selected');
    });
    voteList.appendChild(card);
  });
  attachFilterBar('vote-search', 'vote-filter-count', 'vote-filter-bar', 'vote-list');
}

function renderTargetList() {
  targetList.innerHTML = '';
  gameState.players.forEach((player) => {
    const card = document.createElement('div');
    card.className = 'player-card alive';
    const nameEl = document.createElement('span');
    nameEl.textContent = player.name;
    card.appendChild(nameEl);
    card.addEventListener('click', () => {
      socket.emit('night:action', { targetId: player.id });
      card.classList.add('selected');
    });
    targetList.appendChild(card);
  });
  attachFilterBar('target-search', 'target-filter-count', 'target-filter-bar', 'target-list');
}

function showGameEnded(winner, reason, players) {
  gameEndedDiv.classList.remove('hidden');
  document.getElementById('winner-title').textContent = `${winner.toUpperCase()} WINS!`;
  document.getElementById('win-reason').textContent = reason;

  const resultsGrid = document.getElementById('results-grid');
  resultsGrid.innerHTML = '';
  players.forEach((player) => {
    const card = document.createElement('div');
    const fateClass = player.alive ? 'survived' : 'eliminated';
    const teamClass = player.team === 'werewolf' ? 'werewolf-team' : '';
    card.className = `result-card ${fateClass} ${teamClass}`.trim();

    const nameEl = document.createElement('div');
    nameEl.className = 'result-name';
    nameEl.textContent = escapeHtml(player.name);

    const roleEl = document.createElement('div');
    roleEl.className = 'result-role';
    roleEl.textContent = escapeHtml(player.role);

    const fateEl = document.createElement('div');
    fateEl.className = 'result-fate';
    fateEl.textContent = escapeHtml(player.deathCause);

    card.append(nameEl, roleEl, fateEl);
    resultsGrid.appendChild(card);
  });

  const btn = document.getElementById('play-again-btn');
  const fresh = btn.cloneNode(true);
  btn.replaceWith(fresh);
  fresh.addEventListener('click', () => location.reload());
}

// ─── Ghost screen ─────────────────────────────────────────────────────────────

ghostSendBtn.addEventListener('click', sendGhostMessage);
ghostInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendGhostMessage(); });
ghostPlayAgain.addEventListener('click', () => location.reload());

function sendGhostMessage() {
  const text = ghostInput.value.trim();
  if (!text || !gameState.isDead) return;
  socket.emit('ghost:send', { text });
  ghostInput.value = '';
}

function showDeathOverlay(callback) {
  deathOverlay.classList.remove('hidden');
  setTimeout(() => {
    deathOverlay.classList.add('hidden');
    if (callback) callback();
  }, 3000);
}

function showGhostScreen() {
  // Hide game screen, show ghost screen
  document.getElementById('game-screen').classList.add('hidden');
  ghostScreen.classList.remove('hidden');

  // Populate nameplate
  ghostNameName.textContent = gameState.playerName || 'You';
  ghostNameRole.textContent = gameState.role?.name || '';
  updateGhostPhaseBadge(gameState.phase);
  updateGhostPlayerLists();
}

function updateGhostPhaseBadge(phase) {
  const labels = { night: '🌙 Night', day: '☀️ Day', ended: '⚔️ Ended', lobby: 'Lobby' };
  ghostPhaseBadge.textContent = labels[phase] || phase;
}

function updateGhostPlayerLists() {
  ghostAliveList.innerHTML = '';
  ghostDeadList.innerHTML = '';
  gameState.players.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = p.name + (p.connected === false ? ' (disconnected)' : '');
    if (p.alive) {
      ghostAliveList.appendChild(li);
    } else {
      ghostDeadList.appendChild(li);
    }
  });
}

function appendGhostMessage(data) {
  const el = document.createElement('div');
  el.className = 'ghost-message';
  el.innerHTML = `<strong>${escapeHtml(data.senderName)}:</strong> ${escapeHtml(data.text)}`;
  ghostMessages.appendChild(el);
  ghostMessages.scrollTop = ghostMessages.scrollHeight;
}

console.log('Client loaded');
