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

// Every new connection gets a new id on the server, so the phone has to say who it
// is each time: on page load, and again whenever the connection drops and repairs
// itself (a phone waking from sleep). Without this the phone looks fine but the
// server ignores it.
socket.on('connect', () => {
  const token = localStorage.getItem('werewolf_rejoin_token');
  if (token) {
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
  isDead: false,
};

// What this player has picked in the current phase, by name. Names survive a
// reconnect (ids do not), so lists can be redrawn without losing the choice.
let myVoteName = null;
let myTargetName = null;
let lastVotes = [];

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

// Socket.io event handlers
socket.on('lobby:joined', (data) => {
  rejoinPending = false;
  gameState.roomCode = data.roomCode;
  gameState.playerId = data.playerId;
  if (data.playerName) gameState.playerName = data.playerName;
  if (data.token) localStorage.setItem('werewolf_rejoin_token', data.token);
  showLobbyWait();
});

// Sent in the lobby, and mid-game when someone is removed or reconnects.
socket.on('lobby:updated', (data) => {
  gameState.players = data.players;
  updatePlayerList();
  if (gameState.phase === 'lobby') return;

  if (gameState.isDead) {
    updateGhostPlayerLists();
    return;
  }
  updateGamePlayerList();
  if (gameState.phase === 'day') renderVoteList();
  if (gameState.phase === 'night' && gameState.role && gameState.role.hasNightAction) renderTargetList();
});

socket.on('player:removed', (data) => {
  localStorage.removeItem('werewolf_rejoin_token');
  showError(data.message);
  setTimeout(() => location.reload(), 3000);
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
  if (data.playerName) gameState.playerName = data.playerName;
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
    // After a page refresh the chat is empty and gets the recent messages back.
    // After a silent reconnect the messages are still on screen, so skip them.
    if (chatMessages.children.length === 0) data.recentMessages.forEach((msg) => appendChatMessage(msg));
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
  // A real phase change starts a fresh choice. The moderator setting the timer
  // sends the same phase again, and must not clear what people picked.
  if (data.phase !== gameState.phase) {
    myVoteName = null;
    myTargetName = null;
    lastVotes = [];
  }
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
  lastVotes = data.votes;
  applyVoteCounts();
});

function applyVoteCounts() {
  const voteMap = new Map();
  for (const vote of lastVotes) {
    voteMap.set(vote.targetId, (voteMap.get(vote.targetId) || 0) + 1);
  }
  // Only touch the count badge — never rewrite the card's name or structure
  document.querySelectorAll('#vote-list .player-card').forEach((card) => {
    const count = voteMap.get(card.dataset.playerId) || 0;
    const badge = card.querySelector('.vote-count-badge');
    if (badge) badge.textContent = count > 0 ? ` (${count} vote${count !== 1 ? 's' : ''})` : '';
  });
}

socket.on('vote:result', (data) => {
  showError(`${data.eliminatedName} was voted out with ${data.voteCount} votes!`);
});

socket.on('chat:message', (data) => {
  appendChatMessage(data);
});

socket.on('game:ended', (data) => {
  localStorage.removeItem('werewolf_rejoin_token');
  gameState.phase = 'ended';
  if (gameState.isDead) {
    ghostGameEnded.classList.remove('hidden');
    ghostWinnerTitle.textContent = `${data.winner.toUpperCase()} WINS!`;
    ghostWinReason.textContent = data.winReason;
    updateGhostPhaseBadge('ended');
  } else {
    showGameEnded(data.winner, data.winReason, data.players);
  }
});

socket.on('ghost:message', (data) => {
  appendGhostMessage(data);
});

socket.on('error', (data) => {
  if (rejoinPending) {
    // The saved seat is gone: the game ended, was reset, or the server restarted.
    rejoinPending = false;
    localStorage.removeItem('werewolf_rejoin_token');
    if (gameState.playerId) {
      showError('This game has ended or was reset.');
      setTimeout(() => location.reload(), 3000);
    }
    // On a fresh page a stale seat is not the player's problem, so say nothing.
    return;
  }
  showError(data.message);
});

// Helper functions
let errorTimeout = null;
function showError(message) {
  const errorMessage = document.getElementById('error-message');
  errorMessage.textContent = message;
  errorAlert.classList.remove('hidden');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => {
    errorAlert.classList.add('hidden');
  }, 5000);
}

function showLobbyWait() {
  lobbyScreen.classList.add('hidden');
  lobbyWaitScreen.classList.remove('hidden');
}

function showGameScreen() {
  lobbyScreen.classList.add('hidden');
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

  if (phase !== 'day' && phase !== 'night') {
    // Rejoined after the game finished, or before it started
    phaseTitle.textContent = phase === 'ended' ? 'Game over' : 'Waiting';
    clearInterval(timerInterval);
    timer.textContent = '';
    return;
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
      targetList.innerHTML = '';
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

    if (player.name === myVoteName) card.classList.add('selected');

    card.addEventListener('click', () => {
      document.querySelectorAll('#vote-list .player-card').forEach((c) => c.classList.remove('selected'));
      socket.emit('vote:cast', { targetId: player.id });
      myVoteName = player.name;
      card.classList.add('selected');
    });
    voteList.appendChild(card);
  });
  applyVoteCounts();
}

function renderTargetList() {
  targetList.innerHTML = '';
  gameState.players.forEach((player) => {
    if (!player.alive) return;
    const card = document.createElement('div');
    card.className = 'player-card alive';
    card.dataset.playerId = player.id;
    card.textContent = player.name;
    if (player.name === myTargetName) card.classList.add('selected');
    card.addEventListener('click', () => {
      document.querySelectorAll('#target-list .player-card').forEach((c) => c.classList.remove('selected'));
      socket.emit('night:action', { targetId: player.id });
      myTargetName = player.name;
      card.classList.add('selected');
    });
    targetList.appendChild(card);
  });
}

function showGameEnded(winner, reason, players = []) {
  // Clear the phase panels and the countdown before showing the result
  dayPhaseDiv.classList.add('hidden');
  nightPhaseDiv.classList.add('hidden');
  clearInterval(timerInterval);
  timer.textContent = '';
  phaseTitle.textContent = 'Game over';
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
    nameEl.textContent = player.name;

    const roleEl = document.createElement('div');
    roleEl.className = 'result-role';
    roleEl.textContent = player.role;

    const fateEl = document.createElement('div');
    fateEl.className = 'result-fate';
    fateEl.textContent = player.deathCause || '';

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
