const nameInput = document.getElementById('player-name');
const btnJoin = document.getElementById('btn-join');
const errorEl = document.getElementById('join-error');

nameInput.focus();

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function submit() {
  const playerName = nameInput.value.trim();
  if (!playerName) return showError('Enter your name.');
  if (playerName.length < 2) return showError('Name must be at least 2 characters.');

  sessionStorage.setItem('ww_name', playerName);
  window.location.href = '/player';
}

btnJoin.addEventListener('click', submit);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
