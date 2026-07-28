// Phone controller. Sends intent to the host and renders a small HUD; the
// host owns all game state, so this file never simulates anything.

import { joinRoom, send } from './net.js';
import { heroSheet, loadSprites, spritesReady } from './sprites.js';
import { loadWorldArt, World } from './world.js';
import { Camera, drawScene, drawOffscreenMarkers } from './render.js';
import { SceneBuffer } from './scene.js';
import { bindStick, bindButton } from './controls.js';

const $ = (id) => document.getElementById(id);

const ui = {
  join: $('join'),
  wait: $('wait'),
  pad: $('pad'),
  form: $('joinform'),
  codein: $('codein'),
  namein: $('namein'),
  joinbtn: $('joinbtn'),
  joinerr: $('joinerr'),
  joindiag: $('joindiag'),
  waiterr: $('waiterr'),
  youare: $('youare'),
  waitmsg: $('waitmsg'),
  preview: $('hero-preview'),
  name: $('p-name'),
  hearts: $('p-hearts'),
  wave: $('p-wave'),
  team: $('p-team'),
  score: $('p-score'),
  combo: $('p-combo'),
  rank: $('p-rank'),
  weapon: $('p-weapon'),
  board: $('board'),
  stickZone: $('stick-zone'),
  stick: $('stick'),
  knob: $('knob'),
  btnAttack: $('btn-attack'),
  btnDash: $('btn-dash'),
  coolDash: $('cool-dash'),
  downedOv: $('downed-ov'),
  downedMsg: $('downed-msg'),
  reviveBar: $('revive-bar'),
  waitOv: $('wait-ov'),
  waitOvMsg: $('waitov-msg'),
  overOv: $('over-ov'),
  oWave: $('o-wave'),
  oScore: $('o-score'),
  toast: $('toast'),
  view: $('view'),
};

const input = { ax: 0, ay: 0, attack: false, dash: false };
let conn = null;
let me = null;
let lastSent = 0;
let dashLatch = false;

// Fetch the art up front so the preview and the world are ready on join.
const artReady = Promise.all([loadSprites(), loadWorldArt()]).catch(() => {
  /* surfaced when the art is actually needed */
});

const buffer = new SceneBuffer();
const cam = new Camera(1, 1, 2);
let world = null;
let viewCtx = null;

// Prefill from the QR link.
const params = new URLSearchParams(location.search);
if (params.get('code')) ui.codein.value = params.get('code').toUpperCase().slice(0, 4);
try {
  const saved = localStorage.getItem('pcbt-name');
  if (saved) ui.namein.value = saved;
} catch {
  /* private mode; no big deal */
}

ui.codein.addEventListener('input', () => {
  ui.codein.value = ui.codein.value.toUpperCase().replace(/[^A-Z]/g, '');
});

// ------------------------------------------------------------------ joining

ui.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = ui.codein.value.trim().toUpperCase();
  const name = ui.namein.value.trim();
  if (code.length !== 4 || !name) {
    ui.joinerr.textContent = 'Enter the four-letter room code and a name.';
    return;
  }
  try {
    localStorage.setItem('pcbt-name', name);
  } catch {
    /* ignore */
  }

  ui.joinbtn.disabled = true;
  ui.joinbtn.textContent = 'Connecting…';
  ui.joinerr.textContent = '';
  ui.joindiag.textContent = '';

  try {
    const res = await joinRoom(code);
    conn = res.conn;
    wireConnection(res.peer, res.conn);
    send(conn, { t: 'join', name });
  } catch (err) {
    ui.joinerr.textContent = err.message || String(err);
    // Show what ICE actually managed, so a failure is diagnosable from the
    // phone itself instead of needing a debugger attached.
    ui.joindiag.textContent = err.diagnostics ? err.diagnostics.summary : '';
    ui.joinbtn.disabled = false;
    ui.joinbtn.textContent = 'Join the fight';
  }
});

function wireConnection(peer, c) {
  c.on('data', onMessage);
  c.on('close', () => {
    showScreen('join');
    ui.joinerr.textContent = 'Lost connection to the host. Rejoin with the same name.';
    ui.joinbtn.disabled = false;
    ui.joinbtn.textContent = 'Rejoin';
  });
  peer.on('error', (err) => {
    ui.waiterr.textContent = err.message || String(err);
  });
}

function onMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome':
      me = msg;
      onSeated();
      break;
    case 'roster':
      buffer.setRoster(msg.players);
      break;
    case 'snap':
      buffer.push(msg);
      break;
    case 'reject':
      ui.joinerr.textContent = msg.reason || 'The host turned you away.';
      ui.joinbtn.disabled = false;
      ui.joinbtn.textContent = 'Join the fight';
      showScreen('join');
      break;
    case 'started':
      showScreen('pad');
      ui.waitOv.classList.add('hidden');
      ui.overOv.classList.add('hidden');
      break;
    case 'you':
      applyState(msg);
      break;
    case 'wave':
      toast(msg.boss ? `WAVE ${msg.wave} — BOSS` : `WAVE ${msg.wave}`);
      buzz(msg.boss ? [40, 60, 40] : 25);
      break;
    case 'waveclear':
      toast(`WAVE CLEARED +${msg.bonus}`);
      break;
    case 'hurt':
      buzz(60);
      flash();
      break;
    case 'downed':
      buzz([80, 50, 120]);
      break;
    case 'revived':
      buzz([30, 40, 30]);
      toast('BACK UP');
      break;
    case 'heal':
      toast('+HEART');
      break;
    case 'weapon':
      toast(`${msg.label.toUpperCase()} — ${msg.secs}s`);
      buzz([20, 40, 20]);
      break;
    case 'gameover':
      ui.oWave.textContent = msg.wave;
      ui.oScore.textContent = msg.score;
      renderBoard();
      ui.overOv.classList.remove('hidden');
      buzz([100, 60, 100]);
      break;
  }
}

async function onSeated() {
  await artReady;
  if (!spritesReady()) await loadSprites();
  // The seed alone rebuilds the host's island byte for byte.
  if (me.seed !== undefined && (!world || world.seed !== (me.seed >>> 0))) {
    world = new World(me.seed);
    world.bake();
  }
  if (!viewCtx) viewCtx = ui.view.getContext('2d');
  const sheet = heroSheet(me.slot);
  const src = sheet.down[0];
  ui.preview.width = src.width;
  ui.preview.height = src.height;
  const pctx = ui.preview.getContext('2d');
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, src.width, src.height);
  pctx.drawImage(src, 0, 0);

  ui.youare.textContent = `${me.name} — ${me.colorName}`;
  ui.youare.style.color = me.color;
  ui.name.textContent = me.name;
  ui.name.style.color = me.color;
  document.documentElement.style.setProperty('--knob', me.color);

  if (me.state === 'fighting' || me.state === 'intermission') {
    showScreen('pad');
  } else {
    showScreen('wait');
  }
  keepAwake();
}

function showScreen(which) {
  for (const [k, el] of Object.entries({ join: ui.join, wait: ui.wait, pad: ui.pad })) {
    el.classList.toggle('hidden', k !== which);
  }
}

// ------------------------------------------------------------- HUD updates

function applyState(s) {
  const need = Math.ceil(s.maxHp / 2);
  while (ui.hearts.children.length < need) {
    const h = document.createElement('span');
    h.className = 'heart';
    ui.hearts.appendChild(h);
  }
  for (let i = 0; i < need; i++) {
    const filled = s.hp - i * 2;
    ui.hearts.children[i].className = 'heart' + (filled >= 2 ? ' full' : filled === 1 ? ' half' : '');
  }

  ui.wave.textContent = s.wave;
  ui.team.textContent = s.teamScore;
  ui.score.textContent = s.score;
  ui.combo.textContent = s.combo > 1 ? `· x${s.combo}` : '';
  // Where you sit in the party. Meaningless on your own, so it stays hidden.
  ui.rank.textContent = s.party > 1 && s.rank ? `· ${ordinal(s.rank)}` : '';

  ui.weapon.textContent = s.weapon ? `${s.weaponTag} ${s.weaponSecs}s` : '';
  ui.weapon.classList.toggle('on', !!s.weapon);
  ui.weapon.style.color = s.weaponColor || '';

  lastBoard = s.board || lastBoard;

  // Everyone is down when the run ends, so without the state check the "you're
  // down" panel sits behind the final scoreboard and shows through it.
  const over = s.state === 'gameover';
  ui.downedOv.classList.toggle('hidden', !s.downed || over);
  if (s.downed && !over) {
    if (s.out) {
      // Past the bleedout clock: no teammate can help, so stop showing a
      // meter that can't fill and say what's actually going to happen.
      ui.downedMsg.textContent = 'Too late for a revive — you rejoin the fight when this wave is cleared.';
      ui.reviveBar.parentElement.classList.add('hidden');
    } else {
      ui.downedMsg.textContent = 'A teammate has to stand over you to bring you back.';
      ui.reviveBar.parentElement.classList.remove('hidden');
      // Show revive progress when someone's helping, otherwise the bleedout clock.
      const helping = s.reviving > 0;
      ui.reviveBar.style.width = `${(helping ? s.reviving : s.bleed) * 100}%`;
      ui.reviveBar.style.background = helping ? '#7dfc9a' : '#e2453c';
    }
  }

  ui.coolDash.style.height = `${Math.max(0, s.dashCool) * 100}%`;

  const idle = s.state === 'lobby' || s.state === 'gameover';
  ui.waitOv.classList.toggle('hidden', s.state !== 'lobby');
  if (s.state !== 'gameover') ui.overOv.classList.add('hidden');
  if (idle) {
    input.ax = input.ay = 0;
    input.attack = input.dash = false;
  }
}

// Held back from the last `you` message so the end-of-run board is already
// populated the moment the overlay appears.
let lastBoard = [];

const ordinal = (n) =>
  n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

function renderBoard() {
  ui.board.innerHTML = '';
  for (const r of lastBoard) {
    const li = document.createElement('li');
    if (me && r.slot === me.slot) li.className = 'you';
    li.innerHTML =
      `<span class="rk">${r.rank}</span><span class="dot"></span>` +
      `<span class="who"></span><span class="pts">${r.score} · ${r.kills}k</span>`;
    li.querySelector('.dot').style.background = r.color;
    li.querySelector('.who').textContent = r.name;
    ui.board.appendChild(li);
  }
}

let toastT = null;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => ui.toast.classList.remove('on'), 1400);
}

function flash() {
  ui.pad.classList.remove('flashhit');
  void ui.pad.offsetWidth; // restart the animation
  ui.pad.classList.add('flashhit');
}

function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

async function keepAwake() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {
    /* not granted; the phone may just dim */
  }
}

// ------------------------------------------------------- stick and buttons

const stick = bindStick(ui.stickZone, ui.stick, ui.knob, {
  onChange: (ax, ay) => {
    input.ax = ax;
    input.ay = ay;
  },
});

bindButton(
  ui.btnAttack,
  () => {
    input.attack = true;
  },
  () => {
    input.attack = false;
  }
);

bindButton(
  ui.btnDash,
  () => {
    input.dash = true;
    dashLatch = true;
  },
  () => {
    input.dash = false;
  }
);

// Keyboard for anyone playing on a laptop.
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  keys.add(e.key.toLowerCase());
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function pumpKeys() {
  if (!keys.size) return false;
  const k = (...n) => n.some((x) => keys.has(x));
  const ax = (k('d', 'arrowright') ? 1 : 0) - (k('a', 'arrowleft') ? 1 : 0);
  const ay = (k('s', 'arrowdown') ? 1 : 0) - (k('w', 'arrowup') ? 1 : 0);
  if (ax || ay || k('j', ' ', 'k', 'shift')) {
    input.ax = ax;
    input.ay = ay;
    input.attack = k('j', ' ');
    input.dash = k('k', 'shift');
    return true;
  }
  return false;
}

// ------------------------------------------------------------- world view

function resizeView() {
  const r = ui.view.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(r.width * dpr);
  const h = Math.round(r.height * dpr);
  if (ui.view.width !== w || ui.view.height !== h) {
    ui.view.width = w;
    ui.view.height = h;
  }
  // Integer zoom keeps the pixel art crisp. Aim for roughly 210 logical pixels
  // across the short side, which frames a hero and the fight around them.
  const zoom = Math.max(2, Math.min(5, Math.round(Math.min(w, h) / 210)));
  cam.resize(w, h, zoom);
}

let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (world && viewCtx && !ui.pad.classList.contains('hidden')) {
    resizeView();
    buffer.update(dt);
    const scene = buffer.sample(now);
    if (scene) {
      const mine = scene.players.find((p) => p.slot === me.slot);
      if (mine) cam.followSmooth(mine.x, mine.y, world, dt, 12);
      viewCtx.clearRect(0, 0, cam.w, cam.h);
      drawScene(viewCtx, world, cam, scene, { names: true, highlight: me.id });
      // Teammates off the edge of your own camera.
      drawOffscreenMarkers(viewCtx, cam, scene.players, me.id);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', resizeView);
window.addEventListener('orientationchange', () => setTimeout(resizeView, 250));

// ---------------------------------------------------------------- send loop

function tick() {
  const now = performance.now();
  if (conn && conn.open && now - lastSent > 50) {
    lastSent = now;
    if (!stick.active()) pumpKeys();
    send(conn, {
      t: 'input',
      ax: +input.ax.toFixed(2),
      ay: +input.ay.toFixed(2),
      attack: input.attack,
      // A tap shorter than one send window would otherwise be dropped.
      dash: input.dash || dashLatch,
    });
    dashLatch = false;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Reconnect the peer's screen wake lock after backgrounding.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});
