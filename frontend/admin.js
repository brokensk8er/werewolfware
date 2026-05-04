import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyAXcvi644izGZhK8nPGlkfV4vAc3ZWPH8w",
  authDomain: "nodicetools.firebaseapp.com",
  databaseURL: "https://nodicetools-default-rtdb.firebaseio.com",
  projectId: "nodicetools",
  storageBucket: "nodicetools.firebasestorage.app",
  messagingSenderId: "387258889697",
  appId: "1:387258889697:web:5467488ab109ea67b74ea0",
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── State ────────────────────────────────────────────────────────────────────

let adminSocket      = null;
let activeFilterCat  = 'all';
let selectedPlayerId = null;
let currentPhase     = 'lobby';
let currentPlayers   = [];

let timerInterval = null;
let timerEndsAt   = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const authGate      = document.getElementById('auth-gate');
const dashboard     = document.getElementById('dashboard');
const noGamePanel   = document.getElementById('no-game-panel');
const mainLayout    = document.getElementById('main-layout');

const topbarPhase   = document.getElementById('topbar-phase');
const topbarUser    = document.getElementById('topbar-user');
const logoutBtn     = document.getElementById('logout-btn');

const createGameBtn = document.getElementById('create-game-btn');
const pickerError   = document.getElementById('picker-error');

const playerList    = document.getElementById('player-list');
const playerCount   = document.getElementById('player-count');
const ctrlPhase     = document.getElementById('ctrl-phase');
const ctrlTimer     = document.getElementById('ctrl-timer');
const timerInput    = document.getElementById('timer-input');
const setTimerBtn   = document.getElementById('set-timer-btn');
const advanceBtn    = document.getElementById('advance-phase-btn');
const endGameBtn    = document.getElementById('end-game-btn');
const voteTally     = document.getElementById('vote-tally');
const eventLog      = document.getElementById('event-log');

// Lobby controls
const lobbyControls   = document.getElementById('lobby-controls');
const addPlayerInput  = document.getElementById('add-player-input');
const addPlayerBtn    = document.getElementById('add-player-btn');
const startGameBtn    = document.getElementById('start-game-btn');
const startGameHint   = document.getElementById('start-game-hint');

// Modal
const playerModal      = document.getElementById('player-modal');
const modalName        = document.getElementById('modal-player-name');
const modalClose       = document.getElementById('modal-close');
const renameInput      = document.getElementById('rename-input');
const renameBtn        = document.getElementById('rename-btn');
const roleSelect       = document.getElementById('role-select');
const changeRoleBtn    = document.getElementById('change-role-btn');
const nightActionGroup = document.getElementById('night-action-group');
const nightTargetSel   = document.getElementById('night-target-select');
const nightActionBtn   = document.getElementById('night-action-btn');
const voteGroup        = document.getElementById('vote-group');
const voteTargetSel    = document.getElementById('vote-target-select');
const voteBtn          = document.getElementById('vote-btn');
const removePlayerBtn  = document.getElementById('remove-player-btn');
const eliminateBtn     = document.getElementById('eliminate-btn');
const kickBtn          = document.getElementById('kick-btn');

// ─── Auth ─────────────────────────────────────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists() || snap.data().isAdmin !== true) {
    await signOut(auth);
    window.location.href = 'login.html';
    return;
  }
  topbarUser.textContent = user.email;
  authGate.classList.add('hidden');
  dashboard.classList.remove('hidden');
  connectToGame(user);
});

logoutBtn.addEventListener('click', async () => {
  await signOut(auth);
  window.location.href = 'login.html';
});

// ─── Game connection ──────────────────────────────────────────────────────────

async function connectToGame(user) {
  const token = await user.getIdToken();

  adminSocket = io('https://werewolfware.fly.dev/admin');

  adminSocket.on('connect', () => {
    adminSocket.emit('admin:auth', { token });
  });

  adminSocket.on('admin:authed', () => {
    noGamePanel.classList.add('hidden');
    topbarPhase.classList.remove('hidden');
    mainLayout.classList.remove('hidden');
  });

  adminSocket.on('admin:noGame', () => {
    noGamePanel.classList.remove('hidden');
    mainLayout.classList.add('hidden');
    topbarPhase.classList.add('hidden');
    currentPhase = 'lobby';
    currentPlayers = [];
  });

  adminSocket.on('admin:state', (data) => {
    renderPlayers(data.players);
    renderPhase(data.phase, data.secondsRemaining);
    renderVotes(data.votes);
    data.log.forEach(appendLogEntry);
  });

  adminSocket.on('admin:logEntry',     appendLogEntry);
  adminSocket.on('admin:playerUpdate', (d) => renderPlayers(d.players));
  adminSocket.on('admin:phaseUpdate',  (d) => renderPhase(d.phase, d.secondsRemaining));
  adminSocket.on('admin:voteUpdate',   (d) => renderVotes(d.votes));

  adminSocket.on('error', (data) => {
    pickerError.textContent = data.message;
  });
}

createGameBtn.addEventListener('click', () => {
  if (adminSocket) {
    pickerError.textContent = '';
    adminSocket.emit('admin:createGame');
  }
});

// ─── Phase controls ───────────────────────────────────────────────────────────

advanceBtn.addEventListener('click', () => {
  if (adminSocket) adminSocket.emit('admin:forcePhase');
});

setTimerBtn.addEventListener('click', () => {
  const mins = parseFloat(timerInput.value);
  if (!mins || mins <= 0) return;
  if (adminSocket) adminSocket.emit('admin:setTimer', { seconds: Math.round(mins * 60) });
});

endGameBtn.addEventListener('click', () => {
  if (!adminSocket) return;
  if (!confirm('End the current game? This cannot be undone.')) return;
  adminSocket.emit('admin:endGame');
});

// ─── Lobby controls ───────────────────────────────────────────────────────────

startGameBtn.addEventListener('click', () => {
  if (adminSocket) adminSocket.emit('admin:startGame');
});

addPlayerBtn.addEventListener('click', addPlayerFromInput);

addPlayerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPlayerFromInput();
});

function addPlayerFromInput() {
  const name = addPlayerInput.value.trim();
  if (!name || !adminSocket) return;
  adminSocket.emit('admin:addPlayer', { playerName: name });
  addPlayerInput.value = '';
  addPlayerInput.focus();
}

// ─── Player modal ─────────────────────────────────────────────────────────────

modalClose.addEventListener('click', closeModal);
playerModal.addEventListener('click', (e) => { if (e.target === playerModal) closeModal(); });

renameBtn.addEventListener('click', () => {
  const name = renameInput.value.trim();
  if (!adminSocket || !selectedPlayerId || !name) return;
  adminSocket.emit('admin:renamePlayer', { playerId: selectedPlayerId, newName: name });
  closeModal();
});

changeRoleBtn.addEventListener('click', () => {
  if (!adminSocket || !selectedPlayerId) return;
  adminSocket.emit('admin:changeRole', { playerId: selectedPlayerId, roleId: roleSelect.value });
  closeModal();
});

nightActionBtn.addEventListener('click', () => {
  if (!adminSocket || !selectedPlayerId) return;
  const targetId = nightTargetSel.value;
  if (!targetId) return;
  adminSocket.emit('admin:submitNightAction', { actorId: selectedPlayerId, targetId });
  closeModal();
});

voteBtn.addEventListener('click', () => {
  if (!adminSocket || !selectedPlayerId) return;
  const targetId = voteTargetSel.value;
  if (!targetId) return;
  adminSocket.emit('admin:castVote', { voterId: selectedPlayerId, targetId });
  closeModal();
});

eliminateBtn.addEventListener('click', () => {
  if (!adminSocket || !selectedPlayerId) return;
  if (!confirm('Force-eliminate this player?')) return;
  adminSocket.emit('admin:eliminate', { playerId: selectedPlayerId });
  closeModal();
});

kickBtn.addEventListener('click', () => {
  if (!adminSocket || !selectedPlayerId) return;
  if (!confirm('Kick this player from the game?')) return;
  adminSocket.emit('admin:kick', { playerId: selectedPlayerId });
  closeModal();
});

removePlayerBtn.addEventListener('click', () => {
  if (!adminSocket || !selectedPlayerId) return;
  if (!confirm('Remove this player from the lobby?')) return;
  adminSocket.emit('admin:removePlayer', { playerId: selectedPlayerId });
  closeModal();
});

function openModal(player) {
  selectedPlayerId = player.id;
  modalName.textContent = player.name;
  renameInput.value = player.name;
  roleSelect.value = player.role?.id || 'villager';

  // Lobby vs in-game action buttons
  const inLobby = currentPhase === 'lobby';
  removePlayerBtn.classList.toggle('hidden', !inLobby);
  eliminateBtn.classList.toggle('hidden', inLobby || !player.alive);
  kickBtn.classList.toggle('hidden', inLobby);

  // Night action: show when night phase and this player has a night action role
  const hasNightAction = player.role?.hasNightAction && player.alive;
  const showNight = currentPhase === 'night' && hasNightAction;
  nightActionGroup.classList.toggle('hidden', !showNight);
  if (showNight) {
    populateTargetSelect(nightTargetSel, player.id, true);
  }

  // Vote: show when day phase and player is alive
  const showVote = currentPhase === 'day' && player.alive;
  voteGroup.classList.toggle('hidden', !showVote);
  if (showVote) {
    populateTargetSelect(voteTargetSel, player.id, true);
  }

  playerModal.classList.remove('hidden');
}

function populateTargetSelect(selectEl, excludeId, aliveOnly) {
  selectEl.innerHTML = '';
  currentPlayers
    .filter((p) => p.id !== excludeId && (!aliveOnly || p.alive))
    .forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + (p.alive ? '' : ' 💀');
      selectEl.appendChild(opt);
    });
}

function closeModal() {
  playerModal.classList.add('hidden');
  selectedPlayerId = null;
}

// ─── Log filters ──────────────────────────────────────────────────────────────

document.querySelectorAll('.filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilterCat = btn.dataset.cat;
    applyLogFilter();
  });
});

function applyLogFilter() {
  document.querySelectorAll('.log-entry').forEach((el) => {
    const cat = el.dataset.cat;
    el.classList.toggle('hidden', activeFilterCat !== 'all' && cat !== activeFilterCat);
  });
}

// ─── Render helpers ───────────────────────────────────────────────────────────

const ROLE_COLORS = {
  werewolf: '#c0392b',
  seer:     '#8e44ad',
  doctor:   '#27ae60',
  villager: '#7f8c8d',
};

const CAT_LABELS = {
  system:   { label: 'System',   color: '#c9a227' },
  town:     { label: 'Town',     color: '#3498db' },
  chat:     { label: 'Chat',     color: '#95a5a6' },
  seer:     { label: 'Seer',     color: '#8e44ad' },
  werewolf: { label: 'Wolf',     color: '#c0392b' },
  private:  { label: 'Private',  color: '#e67e22' },
};

function renderPlayers(players) {
  currentPlayers = players;
  playerCount.textContent = players.length;
  playerList.innerHTML = '';

  players.forEach((p) => {
    const roleColor = ROLE_COLORS[p.role?.id] || '#7f8c8d';
    const card = document.createElement('div');
    card.className = 'player-card' + (p.alive ? '' : ' dead');
    const roleName = currentPhase === 'lobby' ? '—' : (p.role?.name ?? '?');
    card.innerHTML = `
      <div class="pc-left">
        <span class="pc-status">${p.alive ? '🟢' : '💀'}</span>
        <span class="pc-name">${escHtml(p.name)}</span>
      </div>
      <div class="pc-right">
        <span class="role-pill" style="--rc:${roleColor}">${escHtml(roleName)}</span>
        <button class="btn-ghost btn-sm">⋯</button>
      </div>
    `;
    card.querySelector('button').addEventListener('click', () => openModal(p));
    playerList.appendChild(card);
  });

  updateLobbyStartButton(players.length);
}

function updateLobbyStartButton(count) {
  if (currentPhase !== 'lobby') return;
  const MIN = 5;
  startGameBtn.disabled = count < MIN;
  if (count < MIN) {
    startGameHint.textContent = `Need at least ${MIN} players (${MIN - count} more)`;
  } else {
    startGameHint.textContent = `${count} players ready — good to go!`;
  }
}

function renderPhase(phase, secondsRemaining) {
  currentPhase = phase;

  ctrlPhase.textContent = phase.toUpperCase();
  ctrlPhase.className = `phase-pill phase-${phase}`;
  topbarPhase.textContent = phase.toUpperCase();
  topbarPhase.className = `topbar-badge phase-badge phase-${phase}`;

  // Show lobby controls only in lobby phase
  lobbyControls.classList.toggle('hidden', phase !== 'lobby');

  // Update start button state based on current player count
  if (phase === 'lobby') updateLobbyStartButton(currentPlayers.length);

  clearInterval(timerInterval);
  if (secondsRemaining > 0 && phase !== 'lobby' && phase !== 'ended') {
    timerEndsAt = Date.now() + secondsRemaining * 1000;
    tickTimer();
    timerInterval = setInterval(tickTimer, 1000);
  } else {
    ctrlTimer.textContent = '—';
  }
}

function tickTimer() {
  const remaining = Math.max(0, Math.round((timerEndsAt - Date.now()) / 1000));
  ctrlTimer.textContent = `${remaining}s`;
  if (remaining <= 0) clearInterval(timerInterval);
}

function renderVotes(votes) {
  if (!votes || votes.length === 0) {
    voteTally.innerHTML = '<p class="muted">No active vote.</p>';
    return;
  }
  const tally = new Map();
  votes.forEach(({ targetId, targetName, voterName }) => {
    if (!tally.has(targetId)) tally.set(targetId, { name: targetName, voters: [] });
    tally.get(targetId).voters.push(voterName);
  });
  const sorted = [...tally.values()].sort((a, b) => b.voters.length - a.voters.length);
  voteTally.innerHTML = sorted.map((t) => `
    <div class="vote-row">
      <span class="vote-name">${escHtml(t.name)}</span>
      <span class="vote-count">${t.voters.length}</span>
      <span class="vote-voters">${t.voters.map(escHtml).join(', ')}</span>
    </div>
  `).join('');
}

function appendLogEntry(entry) {
  const meta  = CAT_LABELS[entry.category] || { label: entry.category, color: '#888' };
  const time  = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const el = document.createElement('div');
  el.className = 'log-entry';
  el.dataset.cat = entry.category;

  const metaStr = entry.meta ? ` <span class="log-meta">${escHtml(entry.meta)}</span>` : '';

  el.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-cat" style="--cc:${meta.color}">${meta.label}</span>
    <span class="log-sender">${escHtml(entry.senderName)}</span>
    <span class="log-text">${escHtml(entry.text)}${metaStr}</span>
  `;

  if (activeFilterCat !== 'all' && entry.category !== activeFilterCat) {
    el.classList.add('hidden');
  }

  eventLog.appendChild(el);
  eventLog.scrollTop = eventLog.scrollHeight;
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[c]));
}
