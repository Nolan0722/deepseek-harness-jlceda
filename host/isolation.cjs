'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

let paths;

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function rejectLinks(root, candidate) {
  // Refuse junctions/symlinks so an apparently local profile cannot target the original installation.
  let cursor = candidate;
  while (inside(root, cursor)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Profile path crosses a link: ${cursor}`);
    cursor = path.dirname(cursor);
  }
}

function selectProfile(argv, labRoot) {
  let selected;
  for (let i = 0; i < argv.length; i++) {
    let candidate;
    if (argv[i] === '--userData') {
      candidate = argv[++i];
      if (!candidate || candidate.startsWith('--')) throw new Error('--userData requires a path');
    } else if (argv[i].startsWith('--userData=')) {
      candidate = argv[i].slice('--userData='.length);
      if (!candidate) throw new Error('--userData requires a path');
    }
    if (candidate !== undefined) {
      const absolute = path.resolve(candidate);
      if (selected && selected.toLowerCase() !== absolute.toLowerCase()) throw new Error('Conflicting --userData paths');
      selected = absolute;
    }
  }
  const profile = selected || path.join(labRoot, 'profile');
  if (!inside(labRoot, profile) || inside(path.join(labRoot, 'client'), profile) || profile.toLowerCase() === path.join(labRoot, 'client').toLowerCase()) {
    throw new Error('Experimental profile must be under lab and outside lab/client');
  }
  return profile;
}

/** Must run before the shipped app evaluates its directory constants. */
function applyPaths(options = {}) {
  if (paths) return paths;
  const { app } = options.electron || require('electron');
  if (app.isReady()) throw new Error('Isolation must be applied before Electron readiness');
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const labRoot = path.join(projectRoot, 'lab');
  const expectedExecutable = path.join(labRoot, 'client', 'lceda-pro.exe');
  if (path.resolve(process.execPath).toLowerCase() !== expectedExecutable.toLowerCase()) {
    throw new Error('Isolation bootstrap may run only inside the copied lab client');
  }
  const userData = selectProfile(options.argv || process.argv, labRoot);
  rejectLinks(projectRoot, userData);
  const documents = path.join(userData, 'documents');
  paths = Object.freeze({ projectRoot, labRoot, lab: labRoot, userData,
    home: path.join(userData, 'home'), documents,
    appData: path.join(userData, 'appdata-roaming'),
    localAppData: path.join(userData, 'appdata-local'),
    dataRoot: path.join(documents, 'LCEDA-Pro'),
    cacheRoot: path.join(userData, 'eda-cache'),
    sessionData: path.join(userData, 'chromium-session'),
    logs: path.join(userData, 'electron-logs'),
    crashDumps: path.join(userData, 'crash-dumps'),
    temp: path.join(userData, 'temp')
  });
  for (const [key, value] of Object.entries(paths)) {
    if (key !== 'projectRoot' && key !== 'labRoot' && key !== 'lab') {
      rejectLinks(projectRoot, value);
      fs.mkdirSync(value, { recursive: true });
    }
  }
  for (const key of ['home', 'documents', 'appData', 'userData', 'sessionData', 'crashDumps', 'temp']) app.setPath(key, paths[key]);
  app.setAppLogsPath(paths.logs);
  app.commandLine.appendSwitch('log-file', path.join(paths.logs, 'chromium.log'));
  process.env.TEMP = paths.temp;
  process.env.TMP = paths.temp;
  process.chdir(labRoot);
  globalThis.__JLC_DSH_ISOLATION__ = paths;
  app.whenReady().then(() => recordState(app, 'ready'));
  return paths;
}

function getPaths() {
  if (!paths) throw new Error('Isolation has not been applied');
  return paths;
}

function recordState(app, phase = 'observed') {
  const p = getPaths();
  const actual = {};
  for (const key of ['home', 'documents', 'appData', 'userData', 'sessionData', 'crashDumps', 'temp', 'logs']) actual[key] = app.getPath(key);
  if (path.resolve(actual.userData).toLowerCase() !== p.userData.toLowerCase()) throw new Error('Shipped app replaced the isolated userData path');
  const endpointName = app.getName().replace(/\s/g, '') + crypto.createHash('sha256').update(actual.userData).digest('hex').slice(0, 8);
  const state = { phase, pid: process.pid, executable: process.execPath, appName: app.getName(), paths: p, actual,
    endpointName, pipe: `\\\\.\\pipe\\${endpointName}`, recordedAt: new Date().toISOString() };
  const logDir = path.join(p.labRoot, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, `isolation-${process.pid}.json`), JSON.stringify(state, null, 2));
  return state;
}

module.exports = { applyPaths, getPaths, recordState, selectProfile };
