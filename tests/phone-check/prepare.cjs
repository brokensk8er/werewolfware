// Builds a throwaway local copy of the app in .work/ for the phone check.
// The repository files are not changed. Three local-only adjustments are made:
//   1. pages talk to the local server, not werewolfware.fly.dev
//   2. the socket.io browser file comes from the local server, not the CDN
//   3. the moderator page skips Google sign-in and uses the server's test switch
//      (ALLOW_TEST_ADMIN=1, which the deployed server refuses)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const work = path.join(__dirname, '.work');
fs.rmSync(work, { recursive: true, force: true });
fs.cpSync(path.join(root, 'backend', 'src'), path.join(work, 'src'), { recursive: true });
fs.cpSync(path.join(root, 'frontend'), path.join(work, 'frontend'), { recursive: true });
// The server is ES modules; this makes Node treat the copy that way.
fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ type: 'module', private: true }));

function edit(file, changes) {
  const p = path.join(work, file);
  let text = fs.readFileSync(p, 'utf8');
  for (const [from, to] of changes) {
    if (!text.includes(from)) throw new Error(`prepare: expected text not found in ${file}: ${from.slice(0, 60)}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(p, text);
}

const cdn = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
edit('frontend/index.html', [[cdn, '/socket.io/socket.io.js']]);
edit('frontend/admin.html', [[cdn, '/socket.io/socket.io.js']]);
edit('frontend/client.js', [["io('https://werewolfware.fly.dev')", 'io()']]);

// Moderator page: cut the Firebase imports and the sign-in block, keep everything else.
{
  const p = path.join(work, 'frontend', 'admin.js');
  let text = fs.readFileSync(p, 'utf8');
  const cut = (startMark, endMark, replacement) => {
    const a = text.indexOf(startMark), b = text.indexOf(endMark);
    if (a < 0 || b < 0 || b < a) throw new Error(`prepare: markers not found in admin.js: ${startMark} … ${endMark}`);
    text = text.slice(0, a) + replacement + text.slice(b);
  };
  cut('import { initializeApp }', '// ─── State', '');
  cut('onAuthStateChanged(auth, async (user) => {', '// ─── Game connection', `{
  window.__tokenCalls = 0;
  const user = { email: 'moderator@example.com', getIdToken: async () => { window.__tokenCalls++; return 'local-test'; } };
  topbarUser.textContent = user.email;
  authGate.classList.add('hidden');
  dashboard.classList.remove('hidden');
  connectToGame(user);
}
logoutBtn.addEventListener('click', () => {});

`);
  fs.writeFileSync(p, text);
}
edit('frontend/admin.js', [["io('https://werewolfware.fly.dev/admin')", "io('/admin')"]]);
console.log('prepared', work);
