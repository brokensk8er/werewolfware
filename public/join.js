const params = new URLSearchParams(location.search);
const gameIdInput = document.getElementById('game-id');
const nameInput = document.getElementById('player-name');
const btnJoin = document.getElementById('btn-join');
const errorEl = document.getElementById('join-error');

// Pre-fill game ID from QR code URL (?join=GAMEID)
const prefill = params.get('join') || params.get('game');
if (prefill) {
  gameIdInput.value = prefill.toUpperCase();
  nameInput.focus();
} else {
  gameIdInput.focus();
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function submit() {
  const gameId = gameIdInput.value.trim().toUpperCase();
  const playerName = nameInput.value.trim();
  if (!gameId) return showError('Enter a game ID.');
  if (gameId.length !== 6) return showError('Game IDs are 6 characters.');
  if (!playerName) return showError('Enter your name.');
  if (playerName.length < 2) return showError('Name must be at least 2 characters.');

  sessionStorage.setItem('ww_name', playerName);
  sessionStorage.setItem('ww_game', gameId);
  window.location.href = `/player?game=${gameId}`;
}

btnJoin.addEventListener('click', submit);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
gameIdInput.addEventListener('input', () => {
  gameIdInput.value = gameIdInput.value.toUpperCase();
});
