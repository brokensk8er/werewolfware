// Werewolfware player page.
//
// The server sends this phone one complete "view" of the game after every change
// (see backend/src/view.ts), and the page redraws from the latest view alone.
// Opening the page, refreshing, and reconnecting after a phone sleeps all take the
// same path: say who we are (the rejoin token), then draw whatever view arrives.
// Chat and errors are the only other messages.

// Utility to prevent XSS
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

const TOKEN_KEY = 'werewolf_rejoin_token';

// Socket.io client
const socket = io('https://werewolfware.fly.dev');

let view = null;      // the latest view from the server
let prevView = null;  // the one before it, to notice moments (a death, a new note)
let rejoinPending = false;
let timerInterval = null;
let deathOverlayShowing = false;

// Kept for tests and debugging: a summary of the latest view.
let gameState = { playerId: null, playerName: null, role: null, players: [], phase: 'lobby', isDead: false };

// Every new connection must say who it is: on page load, and again whenever the
// connection drops and repairs itself (a phone waking from sleep).
socket.on('connect', () => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    rejoinPending = true;
    socket.emit('game:rejoin', { token });
  }
});

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const lobbyScreen = $('lobby-screen');
const lobbyWaitScreen = $('lobby-wait-screen');
const gameScreen = $('game-screen');
const ghostScreen = $('ghost-screen');
const deathOverlay = $('death-overlay');
const errorAlert = $('error-screen');

const playerNameInput = $('player-name');
const joinSubmit = $('join-submit');
const playersUl = $('players-ul');
const gamePlayersUl = $('game-players-ul');

const phaseTitle = $('phase-title');
const timer = $('timer');
const roleName = $('role-name');
const roleDescription = $('role-description');
const rolePack = $('role-pack');
const roleNotes = $('role-notes');

const dayPhaseDiv = $('day-phase');
const nightPhaseDiv = $('night-phase');
const gameEndedDiv = $('game-ended');
const nightInstruction = $('night-instruction');
const voteList = $('vote-list');
const targetList = $('target-list');

const chatMessages = $('chat-messages');
const chatInput = $('chat-input');
const chatSendBtn = $('chat-send-btn');

const ghostNameName = $('ghost-nameplate-name');
const ghostNameRole = $('ghost-nameplate-role');
const ghostPhaseBadge = $('ghost-phase-badge');
const ghostAliveList = $('ghost-alive-list');
const ghostDeadList = $('ghost-dead-list');
const ghostMessages = $('ghost-messages');
const ghostInput = $('ghost-input');
const ghostSendBtn = $('ghost-send-btn');
const ghostGameEnded = $('ghost-game-ended');

// ─── Actions ──────────────────────────────────────────────────────────────────
joinSubmit.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) { showError('Please enter your name'); return; }
  socket.emit('lobby:join', { playerName: name });
  playerNameInput.value = '';
});
playerNameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinSubmit.click(); });

chatSendBtn.addEventListener('click', () => {
  if (!chatInput.value.trim()) return;
  socket.emit('chat:send', { text: chatInput.value });
  chatInput.value = '';
});
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') chatSendBtn.click(); });

ghostSendBtn.addEventListener('click', sendGhostMessage);
ghostInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendGhostMessage(); });
function sendGhostMessage() {
  const text = ghostInput.value.trim();
  if (!text) return;
  socket.emit('ghost:send', { text });
  ghostInput.value = '';
}

// Leaving the end screen forgets the seat, so the page opens on the join form.
function returnToLobby() {
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
}
$('play-again-btn').addEventListener('click', returnToLobby);
$('ghost-play-again-btn').addEventListener('click', returnToLobby);

// ─── Messages from the server ─────────────────────────────────────────────────
socket.on('session', (data) => {
  rejoinPending = false;
  localStorage.setItem(TOKEN_KEY, data.token);
});

socket.on('game:view', (next) => {
  prevView = view;
  view = next;
  gameState = {
    playerId: next.you.id,
    playerName: next.you.name,
    role: next.you.role,
    players: next.players,
    phase: next.phase,
    isDead: !next.you.alive,
  };
  // Moments are judged once per arriving view; render() may run again later
  // (after the death overlay) and must not see the same death twice.
  noticeMoments();
  render();
});

// Sent once after a rejoin. A refreshed page has an empty chat and fills it; a
// phone that only lost its connection still shows its messages and skips this.
socket.on('chat:history', (data) => {
  if (chatMessages.children.length === 0) data.messages.forEach(appendChatMessage);
});

socket.on('chat:message', appendChatMessage);
socket.on('ghost:message', appendGhostMessage);

socket.on('player:removed', (data) => {
  localStorage.removeItem(TOKEN_KEY);
  showError(data.message);
  setTimeout(() => location.reload(), 3000);
});

socket.on('error', (data) => {
  if (rejoinPending) {
    // The saved seat is gone: the game ended, was reset, or the server restarted.
    rejoinPending = false;
    localStorage.removeItem(TOKEN_KEY);
    if (view) {
      showError('This game has ended or was reset.');
      setTimeout(() => location.reload(), 3000);
    }
    // On a fresh page a stale seat is not the player's problem, so say nothing.
    return;
  }
  showError(data.message);
});

// ─── Drawing ──────────────────────────────────────────────────────────────────
function show(screen) {
  for (const s of [lobbyScreen, lobbyWaitScreen, gameScreen, ghostScreen]) s.classList.toggle('hidden', s !== screen);
}

function render() {
  if (!view) { show(lobbyScreen); return; }

  if (view.phase === 'lobby') {
    show(lobbyWaitScreen);
    renderList(playersUl, view.players, (p) => p.name);
    return;
  }

  if (!view.you.alive) {
    // Just died: the overlay plays first, then the ghost screen
    if (!deathOverlayShowing) renderGhost();
    return;
  }

  show(gameScreen);
  $('nameplate-name').textContent = view.you.name;
  $('nameplate-role').textContent = view.you.role ? view.you.role.name : '';
  renderRoleCard();
  renderPhase();
  renderList(gamePlayersUl, view.players, (p) => p.name + (p.connected ? '' : ' (disconnected)'), (li, p) => {
    if (!p.alive) li.style.opacity = '0.4';
  });
}

// Moments the view alone cannot show: a death, a new private result.
function noticeMoments() {
  if (!prevView) return; // first view after a page load: nothing to compare with
  if (prevView.you.alive && !view.you.alive) {
    deathOverlayShowing = true;
    deathOverlay.classList.remove('hidden');
    setTimeout(() => {
      deathOverlayShowing = false;
      deathOverlay.classList.add('hidden');
      render();
    }, 3000);
    return;
  }
  if (view.you.notes.length > prevView.you.notes.length) {
    const note = view.you.notes[view.you.notes.length - 1];
    showError(`${note.at}: ${note.text}`);
    return;
  }
  const wasAlive = new Set(prevView.players.filter((p) => p.alive).map((p) => p.id));
  const fallen = view.players.filter((p) => !p.alive && wasAlive.has(p.id) && p.id !== view.you.id);
  if (fallen.length) showError(`${fallen.map((p) => p.name).join(' and ')} ${fallen.length > 1 ? 'were' : 'was'} eliminated`);
}

function renderRoleCard() {
  const role = view.you.role;
  roleName.textContent = role ? role.name : '';
  roleDescription.textContent = role ? role.description : '';
  // Decision D6: werewolves see their pack
  rolePack.textContent = view.you.pack.length ? `Your pack: ${view.you.pack.join(', ')}` : '';
  rolePack.classList.toggle('hidden', !view.you.pack.length);
  roleNotes.innerHTML = '';
  for (const note of view.you.notes) {
    const li = document.createElement('li');
    li.textContent = `${note.at}: ${note.text}`;
    roleNotes.appendChild(li);
  }
  roleNotes.classList.toggle('hidden', !view.you.notes.length);
}

function renderPhase() {
  dayPhaseDiv.classList.add('hidden');
  nightPhaseDiv.classList.add('hidden');
  gameEndedDiv.classList.add('hidden');

  if (view.phase === 'ended') {
    phaseTitle.textContent = 'Game over';
    stopTimer();
    renderEnded();
    return;
  }

  phaseTitle.textContent = view.phase === 'day' ? `☀️ Day ${view.round}` : `🌙 Night ${view.round}`;
  startTimer(view.secondsRemaining);

  if (view.phase === 'day') {
    dayPhaseDiv.classList.remove('hidden');
    renderChoices(voteList, view.you.voteId, (p) => p.id !== view.you.id, 'vote:cast');
  } else {
    nightPhaseDiv.classList.remove('hidden');
    const role = view.you.role;
    if (role && role.hasNightAction) {
      nightInstruction.textContent = 'Choose your target...';
      const pack = new Set(view.you.pack);
      renderChoices(
        targetList,
        view.you.nightTargetId,
        (p) => (p.id !== view.you.id || role.canTargetSelf) && !pack.has(p.name),
        'night:action',
      );
    } else {
      // Decision D5: roles without a night action only wait
      nightInstruction.textContent = 'Zzz... the werewolves are plotting. Rest until morning.';
      targetList.innerHTML = '';
    }
  }
}

// A list of living players to choose from. The highlight shows what the server
// has recorded, so a refused choice never looks chosen.
function renderChoices(container, chosenId, include, event) {
  container.innerHTML = '';
  for (const p of view.players) {
    if (!p.alive || !include(p)) continue;
    const card = document.createElement('div');
    card.className = 'player-card alive' + (p.id === chosenId ? ' selected' : '');
    card.dataset.playerId = p.id;
    card.dataset.playerName = p.name;
    const nameEl = document.createElement('span');
    nameEl.textContent = p.name;
    card.appendChild(nameEl);
    card.addEventListener('click', () => socket.emit(event, { targetId: p.id }));
    container.appendChild(card);
  }
}

function endTitle(ended) {
  return ended.winner && ended.winner !== 'none' ? `${ended.winner.toUpperCase()} WINS!` : 'GAME ENDED';
}

function renderEnded() {
  const ended = view.ended;
  if (!ended) return;
  gameEndedDiv.classList.remove('hidden');
  $('winner-title').textContent = endTitle(ended);
  $('win-reason').textContent = ended.winReason;
  const grid = $('results-grid');
  grid.innerHTML = '';
  for (const p of ended.players) {
    const card = document.createElement('div');
    card.className = `result-card ${p.alive ? 'survived' : 'eliminated'} ${p.team === 'werewolf' ? 'werewolf-team' : ''}`.trim();
    for (const [cls, text] of [['result-name', p.name], ['result-role', p.role], ['result-fate', p.deathCause || '']]) {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = text;
      card.appendChild(el);
    }
    grid.appendChild(card);
  }
}

function renderGhost() {
  show(ghostScreen);
  ghostNameName.textContent = view.you.name;
  ghostNameRole.textContent = view.you.role ? view.you.role.name : '';
  const labels = { night: `🌙 Night ${view.round}`, day: `☀️ Day ${view.round}`, ended: '⚔️ Ended', lobby: 'Lobby' };
  ghostPhaseBadge.textContent = labels[view.phase] || view.phase;
  const label = (p) => p.name + (p.connected ? '' : ' (disconnected)');
  renderList(ghostAliveList, view.players.filter((p) => p.alive), label);
  renderList(ghostDeadList, view.players.filter((p) => !p.alive), label);
  ghostGameEnded.classList.toggle('hidden', !view.ended);
  if (view.ended) {
    $('ghost-winner-title').textContent = endTitle(view.ended);
    $('ghost-win-reason').textContent = view.ended.winReason;
  }
}

function renderList(ul, players, label, decorate) {
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    li.textContent = label(p);
    if (decorate) decorate(li, p);
    ul.appendChild(li);
  }
}

// The countdown restarts from the server's figure with every view.
function startTimer(seconds) {
  clearInterval(timerInterval);
  let remaining = seconds;
  timer.textContent = `${remaining}s`;
  timerInterval = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    timer.textContent = `${remaining}s`;
    if (remaining === 0) clearInterval(timerInterval);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timer.textContent = '';
}

// ─── Chat and toasts ──────────────────────────────────────────────────────────
function appendChatMessage(data) {
  const msgEl = document.createElement('div');
  msgEl.className = data.senderId === '__system__' ? 'chat-message chat-system' : 'chat-message';
  msgEl.innerHTML = `<strong>${escapeHtml(data.senderName)}:</strong> ${escapeHtml(data.text)}`;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendGhostMessage(data) {
  const el = document.createElement('div');
  el.className = 'ghost-message';
  el.innerHTML = `<strong>${escapeHtml(data.senderName)}:</strong> ${escapeHtml(data.text)}`;
  ghostMessages.appendChild(el);
  ghostMessages.scrollTop = ghostMessages.scrollHeight;
}

let errorTimeout = null;
function showError(message) {
  $('error-message').textContent = message;
  errorAlert.classList.remove('hidden');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => errorAlert.classList.add('hidden'), 5000);
}

render();
