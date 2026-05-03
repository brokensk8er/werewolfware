// Socket.io client
const socket = io();

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

const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const createForm = document.getElementById('create-form');
const joinForm = document.getElementById('join-form');

const creatorName = document.getElementById('creator-name');
const roomCode = document.getElementById('room-code');
const playerName = document.getElementById('player-name');

const createSubmit = document.getElementById('create-submit');
const createCancel = document.getElementById('create-cancel');
const joinSubmit = document.getElementById('join-submit');
const joinCancel = document.getElementById('join-cancel');

const roomCodeDisplay = document.getElementById('room-code-display');
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

// Event listeners
createBtn.addEventListener('click', () => {
  createForm.classList.remove('hidden');
});

joinBtn.addEventListener('click', () => {
  joinForm.classList.remove('hidden');
});

createCancel.addEventListener('click', () => {
  createForm.classList.add('hidden');
});

joinCancel.addEventListener('click', () => {
  joinForm.classList.add('hidden');
});

createSubmit.addEventListener('click', () => {
  const name = creatorName.value.trim();
  if (!name) {
    showError('Please enter your name');
    return;
  }
  socket.emit('lobby:create', { playerName: name });
  creatorName.value = '';
});

joinSubmit.addEventListener('click', () => {
  const code = roomCode.value.trim().toUpperCase();
  const name = playerName.value.trim();
  if (!code || !name) {
    showError('Please enter room code and name');
    return;
  }
  socket.emit('lobby:join', { roomCode: code, playerName: name });
  roomCode.value = '';
  playerName.value = '';
});

startGameBtn.addEventListener('click', () => {
  socket.emit('game:start');
});

// Socket.io event handlers
socket.on('lobby:created', (data) => {
  gameState.roomCode = data.roomCode;
  gameState.playerId = data.playerId;
  gameState.isHost = true;
  showLobbyWait();
  createForm.classList.add('hidden');
});

socket.on('lobby:joined', (data) => {
  gameState.roomCode = data.roomCode;
  gameState.playerId = data.playerId;
  showLobbyWait();
  joinForm.classList.add('hidden');
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
  roomCodeDisplay.textContent = gameState.roomCode;
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
    const card = document.createElement('div');
    card.className = 'player-card alive';
    card.textContent = player.name;
    card.addEventListener('click', () => {
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
