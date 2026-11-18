'use strict';
/* PLAYWRIGHT BROWSERS THAT LEAVE NOTHING BEHIND.

   THE LEAK. Every chromium.launch() makes a profile folder in %TEMP%
   (playwright_chromiumdev_profile-*), and Chromium makes scoped_dir* folders
   next to it. Playwright deletes them only when browser.close() runs to the
   end. A script that throws first, is stopped with Ctrl+C, or is killed by a
   timeout leaves the folder (about 60 MB) and often a hidden browser. Run
   hundreds of times, that was tens of GB.

   THE FIX. Import browsers from here instead of from 'playwright':
     import { chromium } from './tidy-browser.cjs';        (ESM)
     const { chromium } = require('./tidy-browser.cjs');   (CommonJS)
   1. Each run gets its own temp folder, %TEMP%\pw-run-<pid>, and TEMP/TMP/
      TMPDIR point there, so the profile, Chromium's scratch folders and any
      other temp file the run makes all land in one place.
   2. On every way out (normal end, a throw, process.exit, Ctrl+C, SIGTERM) the
      open browsers are closed, any browser process still naming that folder
      is killed with its whole tree, and the folder is deleted.
   3. At startup it sweeps what earlier runs left when they were killed too
      hard for 2 to run: pw-run-* folders whose process is gone, and stray
      Playwright profiles and scoped_dir folders over an hour old. A folder in
      use is skipped, never half deleted. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const pw = (() => { try { return require('playwright'); } catch { return require('@playwright/test'); } })();
const WIN = process.platform === 'win32';
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/* Processes whose command line names a pw-run folder, as { pid, run }. One
   call, since PowerShell takes about a second to start. */
function namingRuns() {
  try {
    if (WIN) {
      const out = cp.execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pw-run-[0-9]+' } | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true });
      return parse(out);
    }
    return parse(cp.execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return []; }
  function parse(out) {
    return out.split(/\r?\n/).map((l) => /^\s*([0-9]+)\s.*pw-run-([0-9]+)(?![0-9])/.exec(l)).filter(Boolean)
      .map((m) => ({ pid: +m[1], run: +m[2] })).filter((p) => p.pid !== process.pid);
  }
}
function killTree(pid) {
  try {
    if (WIN) cp.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch {}
}
function remove(p) {
  for (let i = 0; i < 12 && fs.existsSync(p); i++) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
    if (fs.existsSync(p)) nap(250);
  }
  return !fs.existsSync(p);
}

const state = globalThis.__tidyBrowser || (globalThis.__tidyBrowser = (() => {
  /* A browser or test worker started by a run inherits its folder and leaves
     the cleanup to the process that made it. */
  if (process.env.PW_TIDY_RUN) return { run: process.env.PW_TIDY_RUN, owner: false, open: new Set() };

  const base = process.env.TEMP || process.env.TMP || process.env.TMPDIR || os.tmpdir();
  sweep(base);
  const run = path.join(base, 'pw-run-' + process.pid);
  fs.mkdirSync(run, { recursive: true });
  process.env.PW_TIDY_RUN = run;
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = run;
  const s = { run, owner: true, open: new Set(), done: false };

  const tidy = () => {
    if (s.done) return;
    s.done = true;
    if (s.open.size || !remove(run)) {
      for (let i = 0; i < 10; i++) {
        const left = namingRuns().filter((p) => p.run === process.pid);
        if (!left.length) break;
        left.forEach((p) => killTree(p.pid));
        nap(300);
      }
      remove(run);
    }
  };
  process.on('exit', tidy);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129], ['SIGBREAK', 149]]) {
    process.on(sig, () => {
      const closes = [...s.open].map((b) => Promise.race([b.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]));
      Promise.all(closes).finally(() => process.exit(code));
    });
  }
  return s;

  function sweep(dir) {
    const hourAgo = Date.now() - 3600000;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    const deadRuns = names.map((n) => /^pw-run-([0-9]+)(-gone)?$/.exec(n)).filter((m) => m && !alive(+m[1]));
    /* A run killed too hard to tidy can leave its browser running, holding
       the folder. Stop those browsers first. */
    if (deadRuns.length) {
      const dead = new Set(deadRuns.map((m) => +m[1]));
      namingRuns().filter((p) => dead.has(p.run)).forEach((p) => killTree(p.pid));
    }
    for (const n of names) {
      const run = /^pw-run-([0-9]+)(-gone)?$/.exec(n);
      const stray = /^(playwright_(chromium|firefox|webkit)dev_profile-|playwright-artifacts-|scoped_dir[0-9]+_)/.test(n);
      if (!run && !stray) continue;
      const p = path.join(dir, n);
      if (run && alive(+run[1])) continue;
      if (stray) { try { if (fs.statSync(p).mtimeMs > hourAgo) continue; } catch { continue; } }
      /* Renamed first: Windows refuses while anything holds a file inside, so
         a folder in use is skipped whole. */
      const doomed = n.endsWith('-gone') ? p : p + '-gone';
      try { if (doomed !== p) fs.renameSync(p, doomed); fs.rmSync(doomed, { recursive: true, force: true }); } catch {}
    }
  }
})());

function track(type) {
  if (!type) return type;
  return new Proxy(type, {
    get(t, key) {
      const v = Reflect.get(t, key);
      if (key === 'launch' || key === 'launchPersistentContext') {
        return async (...args) => {
          const b = await v.apply(t, args);
          state.open.add(b);
          b.on(key === 'launch' ? 'disconnected' : 'close', () => state.open.delete(b));
          return b;
        };
      }
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

exports.chromium = track(pw.chromium);
exports.firefox = track(pw.firefox);
exports.webkit = track(pw.webkit);
exports.devices = pw.devices;
exports.runFolder = state.run;
