// See Multiplier running with demo data, with one command:   npm run demo
//
// It builds the app if it needs to, fills a brand-new workspace with a demo campaign and prospects
// (only the first time), starts the server on a free port and opens your browser. Plain JavaScript with
// no dependencies, so it can explain what's wrong even when something else isn't set up yet.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const say = (s = '') => console.log(s);
const stop = (title, ...lines) => {
  console.error(`\n  ${title}\n`);
  for (const l of lines) console.error(`  ${l}`);
  console.error();
  process.exit(1);
};

// ── 1. Is this machine ready? ───────────────────────────────────────────────

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  stop(
    `Multiplier needs Node 22.13 or newer, and this is Node ${process.versions.node}.`,
    'Install the current LTS from https://nodejs.org, then open a NEW terminal window and run this again.',
  );
}
if (!fs.existsSync('node_modules')) {
  stop(
    'The app’s ingredients haven’t been downloaded yet.',
    'Run   npm install   (it takes a minute or two), then   npm run demo   again.',
  );
}
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env is fine */
}

// ── 2. Build, if the build is missing or older than the code ────────────────

const mtime = (f) => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
};
const newestIn = (dir) => {
  let newest = 0;
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestIn(p) : mtime(p));
  }
  return newest;
};
const sourcesChanged = Math.max(
  newestIn('src'),
  newestIn('web/src'),
  mtime('scripts/seed.ts'),
  mtime('web/index.html'),
  mtime('package.json'),
);
const builtAt = Math.min(mtime('dist/server/index.js'), mtime('dist/seed.js'), mtime('web/dist/index.html'));
if (!builtAt || sourcesChanged > builtAt) {
  say('\n  Building Multiplier (the first time takes about 20 seconds)…\n');
  if (spawnSync('npm run build', { stdio: 'inherit', shell: true }).status !== 0) {
    stop(
      'The build failed, so there is nothing to start.',
      'The messages above say why. If you can’t see the cause, send them to whoever is helping you.',
    );
  }
}

// ── 3. Demo data, but only for a workspace nobody has used ──────────────────

const dataDir = path.resolve(process.env.DATA_DIR || './.data');
const marker = path.join(dataDir, 'demo-seeded');
const nodeArgs = ['--disable-warning=ExperimentalWarning'];
if (!fs.existsSync(path.join(dataDir, 'multiplier.db'))) {
  say('\n  Loading demo data…');
  const seeded = spawnSync(process.execPath, [...nodeArgs, 'dist/seed.js'], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (seeded.status !== 0) stop('The demo data could not be loaded.', 'The messages above say why.');
  fs.writeFileSync(marker, new Date().toISOString());
}
const hasDemo = fs.existsSync(marker);

// ── 4. A port nothing else is using ─────────────────────────────────────────

const canBind = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
// something listening only on IPv6 would still answer a browser that opens "localhost"
const somethingAnswers = async (port) => {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800) });
    return true;
  } catch (e) {
    return e?.name === 'TimeoutError';
  }
};
let port = Number(process.env.PORT) || 3000;
for (let tries = 0; tries < 30 && !((await canBind(port)) && !(await somethingAnswers(port))); tries++) port++;
const url = `http://localhost:${port}`;

// ── 5. Start it ─────────────────────────────────────────────────────────────

const server = spawn(process.execPath, [...nodeArgs, 'dist/server/index.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: String(port),
    APP_URL: url,
    PUBLIC_URL: '', // links use the app's own address
    HOST: '127.0.0.1', // this machine only: the demo password is public knowledge
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
  },
});
let ready = false;
server.once('exit', (code) => {
  if (!ready) stop('Multiplier stopped before it was ready.', 'The messages above say why.');
  say('\n  Stopped. Run   npm run demo   to start it again.\n');
  process.exit(code ?? 0);
});
// Ctrl+C reaches the server too (same terminal), which shuts down cleanly and ends this script
process.on('SIGINT', () => undefined);

for (let i = 0; i < 100 && !ready; i++) {
  try {
    ready = (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    await new Promise((r) => setTimeout(r, 300));
  }
}
if (!ready) {
  server.kill();
  stop('Multiplier didn’t start within 30 seconds.', 'The messages above may say why.');
}

const title = `Multiplier is running  →  ${url}`;
const bar = '─'.repeat(title.length + 4);
say(`
  ┌${bar}┐
  │  ${title}  │
  └${bar}┘
${
  hasDemo
    ? `
  Sign in with   demo@multiplier.local
  Password       multiplier-demo

  Start with the campaign “Outbound Playbook — Q4”.`
    : '\n  Sign in with the account you created earlier.'
}

  Leave this window open while you look around. Press Ctrl+C to stop.
`);

const opener =
  process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
try {
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
} catch {
  /* the address above works in any browser */
}
