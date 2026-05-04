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

// Game state
let gameState = {
  roomCode: null,
  playerId: null,
  playerName: null,
  role: null,
  players: [],
  phase: 'lobby',
  isHost: false,
};

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

socket.on('phase:changed', (data) => {
  gameState.phase = data.phase;
  updatePhaseDisplay(data.phase, data.secondsRemaining);
});

socket.on('player:eliminated', (data) => {
  showError(`${data.playerName} (${data.role}) was eliminated!`);
  // Update player list to mark as dead
  gameState.players = gameState.players.map((p) =>
    p.id === data.playerId ? { ...p, alive: false } : p
  );
  updateGamePlayerList();
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
  // Update vote display in real-time
  const voteMap = new Map();
  for (const vote of data.votes) {
    if (!voteMap.has(vote.targetId)) {
      voteMap.set(vote.targetId, { name: vote.targetName, count: 0 });
    }
    voteMap.get(vote.targetId).count++;
  }

  // Update vote cards with vote counts
  const cards = document.querySelectorAll('#vote-list .player-card');
  cards.forEach((card) => {
    const playerId = card.dataset.playerId;
    const voteInfo = voteMap.get(playerId);
    if (voteInfo) {
      card.innerHTML = `${card.textContent.split(' ')[0]}<br><small>(${voteInfo.count} vote${voteInfo.count !== 1 ? 's' : ''})</small>`;
    }
  });
});

socket.on('vote:result', (data) => {
  showError(`${data.eliminatedName} was voted out with ${data.voteCount} votes!`);
});

socket.on('chat:message', (data) => {
  const msgEl = document.createElement('div');
  const isSystem = data.senderId === '__system__';
  msgEl.className = isSystem ? 'chat-message chat-system' : 'chat-message';
  msgEl.innerHTML = `<strong>${escapeHtml(data.senderName)}:</strong> ${escapeHtml(data.text)}`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('game:ended', (data) => {
  showGameEnded(data.winner, data.winReason);
});

socket.on('error', (data) => {
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
    gamePlayersUl.appendChild(li);
  });
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
  let remaining = seconds;
  timer.textContent = `${remaining}s`;

  const interval = setInterval(() => {
    remaining--;
    timer.textContent = `${remaining}s`;
    if (remaining <= 0) {
      clearInterval(interval);
    }
  }, 1000);
}

function renderVoteList() {
  voteList.innerHTML = '';
  gameState.players.forEach((player) => {
    if (!player.alive) return; // Only show alive players
    const card = document.createElement('div');
    card.className = 'player-card alive';
    card.dataset.playerId = player.id;
    card.textContent = player.name;
    card.addEventListener('click', () => {
      // Clear previous selection
      document.querySelectorAll('#vote-list .player-card').forEach((c) => {
        c.classList.remove('selected');
      });
      socket.emit('vote:cast', { targetId: player.id });
      card.classList.add('selected');
    });
    voteList.appendChild(card);
  });
}

function renderTargetList() {
  targetList.innerHTML = '';
  gameState.players.forEach((player) => {
    const card = document.createElement('div');
    card.className = 'player-card alive';
    card.textContent = player.name;
    card.addEventListener('click', () => {
      socket.emit('night:action', { targetId: player.id });
      card.classList.add('selected');
    });
    targetList.appendChild(card);
  });
}

function showGameEnded(winner, reason) {
  gameEndedDiv.classList.remove('hidden');
  const winnerTitle = document.getElementById('winner-title');
  const winReason = document.getElementById('win-reason');
  const playAgainBtn = document.getElementById('play-again-btn');

  winnerTitle.textContent = `${winner.toUpperCase()} WINS!`;
  winReason.textContent = reason;

  playAgainBtn.addEventListener('click', () => {
    location.reload();
  });
}

console.log('Client loaded');
