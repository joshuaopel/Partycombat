// Phone controller. Sends intent to the host and renders a small HUD; the
// host owns all game state, so this file never simulates anything.

import { joinRoom, send } from './net.js';
import { heroSheet } from './sprites.js';

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
};

const input = { ax: 0, ay: 0, attack: false, dash: false };
let conn = null;
let me = null;
let lastSent = 0;
let dashLatch = false;

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

  try {
    const res = await joinRoom(code);
    conn = res.conn;
    wireConnection(res.peer, res.conn);
    send(conn, { t: 'join', name });
  } catch (err) {
    ui.joinerr.textContent = err.message || String(err);
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
    case 'gameover':
      ui.oWave.textContent = msg.wave;
      ui.oScore.textContent = msg.score;
      ui.overOv.classList.remove('hidden');
      buzz([100, 60, 100]);
      break;
  }
}

function onSeated() {
  const sheet = heroSheet(me.slot);
  const pctx = ui.preview.getContext('2d');
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, 16, 16);
  pctx.drawImage(sheet.down[0], 0, 0);

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

  ui.downedOv.classList.toggle('hidden', !s.downed);
  if (s.downed) {
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

// --------------------------------------------------------------- the stick

const STICK_RADIUS = 56;
let stickId = null;
let originX = 0;
let originY = 0;

function stickStart(x, y, id) {
  stickId = id;
  originX = x;
  originY = y;
  const r = ui.stickZone.getBoundingClientRect();
  ui.stick.style.left = `${x - r.left}px`;
  ui.stick.style.top = `${y - r.top}px`;
  ui.stick.classList.add('on');
  stickMove(x, y);
}

function stickMove(x, y) {
  let dx = x - originX;
  let dy = y - originY;
  const d = Math.hypot(dx, dy);
  if (d > STICK_RADIUS) {
    dx = (dx / d) * STICK_RADIUS;
    dy = (dy / d) * STICK_RADIUS;
  }
  ui.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  // Small deadzone so resting thumbs don't drift the hero.
  const norm = Math.min(1, d / STICK_RADIUS);
  if (norm < 0.16) {
    input.ax = input.ay = 0;
  } else {
    const k = Math.hypot(dx, dy) || 1;
    input.ax = (dx / k) * norm;
    input.ay = (dy / k) * norm;
  }
}

function stickEnd() {
  stickId = null;
  ui.stick.classList.remove('on');
  ui.knob.style.transform = 'translate(0,0)';
  input.ax = input.ay = 0;
}

ui.stickZone.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    if (stickId !== null) return;
    const t = e.changedTouches[0];
    stickStart(t.clientX, t.clientY, t.identifier);
  },
  { passive: false }
);

ui.stickZone.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) stickMove(t.clientX, t.clientY);
    }
  },
  { passive: false }
);

const endTouch = (e) => {
  for (const t of e.changedTouches) if (t.identifier === stickId) stickEnd();
};
ui.stickZone.addEventListener('touchend', endTouch);
ui.stickZone.addEventListener('touchcancel', endTouch);

// Mouse fallback so the controller is testable on a laptop.
ui.stickZone.addEventListener('mousedown', (e) => {
  stickStart(e.clientX, e.clientY, 'mouse');
  const mm = (ev) => stickMove(ev.clientX, ev.clientY);
  const mu = () => {
    stickEnd();
    window.removeEventListener('mousemove', mm);
    window.removeEventListener('mouseup', mu);
  };
  window.addEventListener('mousemove', mm);
  window.addEventListener('mouseup', mu);
});

// -------------------------------------------------------------- action keys

function bindButton(el, onDown, onUp) {
  const down = (e) => {
    e.preventDefault();
    el.classList.add('held');
    onDown();
  };
  const up = (e) => {
    e.preventDefault();
    el.classList.remove('held');
    onUp();
  };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', () => {
    el.classList.remove('held');
    onUp();
  });
}

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

// ---------------------------------------------------------------- send loop

function tick() {
  const now = performance.now();
  if (conn && conn.open && now - lastSent > 50) {
    lastSent = now;
    if (stickId === null) pumpKeys();
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
