// Host screen: owns the peer, the lobby, the simulation and the big display.

import { startHost, send, MAX_PLAYERS } from './net.js';
import { Game } from './game.js';
import { heroSheet, PLAYER_COLORS } from './sprites.js';

const $ = (id) => document.getElementById(id);

const ui = {
  lobby: $('lobby'),
  stage: $('stage'),
  code: $('code'),
  joinurl: $('joinurl'),
  qr: $('qr'),
  slots: $('slots'),
  count: $('count'),
  start: $('start'),
  localplay: $('localplay'),
  lobbyerr: $('lobbyerr'),
  topbar: $('topbar'),
  sWave: $('s-wave'),
  sLeft: $('s-left'),
  sScore: $('s-score'),
  sInter: $('s-inter'),
  sCode: $('s-code'),
  canvas: $('game'),
  gameover: $('gameover'),
  goWave: $('go-wave'),
  goScore: $('go-score'),
  goRows: $('go-rows'),
  again: $('again'),
  status: $('status'),
};

const ctx = ui.canvas.getContext('2d');
const conns = new Map(); // playerId -> DataConnection
const LOCAL_ID = '__local__';

const game = new Game({ onEvent: handleGameEvent });
// Handy from the console when something goes sideways mid-party.
window.__game = game;
let roomCode = '';
let peer = null;

// ------------------------------------------------------------------ startup

// Paint the lobby and start the render loop immediately — the room code
// arrives asynchronously and a slow CDN shouldn't leave a dead screen.
renderSlots();
requestAnimationFrame(loop);

(async function boot() {
  try {
    const { peer: p, code } = await startHost();
    peer = p;
    roomCode = code;
    ui.code.textContent = code;
    ui.code.classList.remove('pending');
    ui.sCode.textContent = code;
    showJoinTarget(code);
    peer.on('connection', onConnection);
    peer.on('error', (err) => setStatus(`peer error: ${err.type || err.message}`));
    peer.on('disconnected', () => {
      setStatus('reconnecting…');
      peer.reconnect();
    });
    setStatus('room open');
  } catch (err) {
    ui.code.textContent = 'Offline';
    ui.qr.remove();
    ui.joinurl.textContent = 'Could not reach the matchmaking service.';
    ui.lobbyerr.textContent = err.message || String(err);
  }
})();

function showJoinTarget(code) {
  const url = new URL('play.html', location.href);
  const bare = url.href.replace(/^https?:\/\//, '');
  // Carry any custom PeerServer settings through to the phones.
  for (const k of ['host', 'port', 'path', 'secure']) {
    const v = new URLSearchParams(location.search).get(k);
    if (v !== null) url.searchParams.set(k, v);
  }
  url.searchParams.set('code', code);
  ui.joinurl.innerHTML = `${bare}`;
  try {
    // qrcode-generator is optional; the code alone is enough to join.
    const qr = window.qrcode(0, 'M');
    qr.addData(url.href);
    qr.make();
    ui.qr.innerHTML = qr.createImgTag(4, 0);
  } catch {
    ui.qr.remove();
  }
}

function setStatus(text) {
  ui.status.textContent = text;
}

// --------------------------------------------------------------- networking

function onConnection(conn) {
  let playerId = null;

  conn.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join') {
      if (playerId) return; // already seated on this connection
      const name = String(msg.name || '').replace(/[^\w \-!?]/g, '').trim();

      // Let a dropped player reclaim their seat by name.
      const existing = [...game.players.values()].find(
        (p) => !p.connected && p.name === name.slice(0, 10).toUpperCase()
      );
      let p = existing;
      if (p) {
        p.connected = true;
      } else {
        if (game.players.size >= MAX_PLAYERS) {
          send(conn, { t: 'reject', reason: 'This room is full (6 heroes max).' });
          return;
        }
        if (game.state !== 'lobby' && game.state !== 'gameover') {
          // Mid-run joins drop straight in rather than waiting out the wave.
          p = game.addPlayer(conn.peer, name);
          if (p) p.hp = p.maxHp;
        } else {
          p = game.addPlayer(conn.peer, name);
        }
        if (!p) {
          send(conn, { t: 'reject', reason: 'This room is full (6 heroes max).' });
          return;
        }
      }
      playerId = p.id;
      conns.set(playerId, conn);
      markAlive(playerId);
      send(conn, {
        t: 'welcome',
        id: p.id,
        name: p.name,
        slot: p.slot,
        color: p.color.t,
        colorName: p.color.name,
        state: game.state,
      });
      renderSlots();
      return;
    }

    if (playerId) markAlive(playerId);

    if (msg.t === 'input' && playerId) {
      game.setInput(playerId, msg);
      return;
    }

    if (msg.t === 'ping') send(conn, { t: 'pong', n: msg.n });
  });

  const drop = () => {
    if (!playerId) return;
    conns.delete(playerId);
    const p = game.players.get(playerId);
    if (!p) return;
    if (game.state === 'lobby' || game.state === 'gameover') {
      game.removePlayer(playerId);
    } else {
      // Keep the body in play so the run isn't disrupted; they can rejoin.
      p.connected = false;
      p.input = { ax: 0, ay: 0, attack: false, dash: false };
    }
    renderSlots();
  };
  conn.on('close', drop);
  conn.on('error', drop);
}

// A closed page doesn't reliably produce a WebRTC 'close' event — a locked
// phone or a dropped Wi-Fi connection just goes quiet. Controllers send input
// continuously, so treat silence as a disconnect. This runs on a timer rather
// than in the render loop so it still ticks if the host tab is backgrounded.
const lastSeen = new Map();
const HEARTBEAT_TIMEOUT = 5000;

function markAlive(id) {
  lastSeen.set(id, performance.now());
  const p = game.players.get(id);
  if (p && !p.connected) {
    p.connected = true;
    renderSlots();
  }
}

setInterval(() => {
  const now = performance.now();
  let changed = false;
  for (const p of game.players.values()) {
    if (p.id === LOCAL_ID) continue;
    const seen = lastSeen.get(p.id) ?? 0;
    if (p.connected && now - seen > HEARTBEAT_TIMEOUT) {
      p.connected = false;
      p.input = { ax: 0, ay: 0, attack: false, dash: false };
      changed = true;
      if (game.state === 'lobby' || game.state === 'gameover') {
        game.removePlayer(p.id);
        conns.delete(p.id);
        lastSeen.delete(p.id);
      }
    }
  }
  if (changed) renderSlots();
}, 1000);

function toPlayer(id, msg) {
  const c = conns.get(id);
  if (c) send(c, msg);
}

function broadcast(msg) {
  for (const c of conns.values()) send(c, msg);
}

function handleGameEvent(ev) {
  switch (ev.t) {
    case 'hurt':
    case 'downed':
    case 'revived':
    case 'heal':
      toPlayer(ev.id, ev);
      break;
    case 'wave':
      broadcast({ t: 'wave', wave: ev.wave, boss: ev.boss });
      break;
    case 'waveclear':
      broadcast({ t: 'waveclear', wave: ev.wave, bonus: ev.bonus });
      break;
    case 'gameover':
      broadcast({ t: 'gameover', wave: ev.wave, score: ev.score });
      showGameOver(ev);
      break;
  }
}

// --------------------------------------------------------------- lobby view

function slotPreview(slot) {
  const cv = document.createElement('canvas');
  cv.width = 48;
  cv.height = 48;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(heroSheet(slot).down[0], 0, 0, 16, 16, 0, 0, 48, 48);
  return cv;
}

function renderSlots() {
  const players = [...game.players.values()].sort((a, b) => a.slot - b.slot);
  const bySlot = new Map(players.map((p) => [p.slot, p]));
  ui.slots.innerHTML = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = bySlot.get(i);
    const div = document.createElement('div');
    div.className = 'slot' + (p ? ' filled' : '');
    if (p) div.style.borderColor = p.color.t;
    div.appendChild(slotPreview(i));
    const who = document.createElement('div');
    who.className = 'who';
    who.innerHTML = p
      ? `<div class="nm">${escapeHtml(p.name)}</div><div class="cl">${PLAYER_COLORS[i].name}${p.connected ? '' : ' · offline'}</div>`
      : `<div class="cl">Empty — ${PLAYER_COLORS[i].name}</div>`;
    div.appendChild(who);
    ui.slots.appendChild(div);
  }
  ui.count.textContent = `(${game.players.size}/${MAX_PLAYERS})`;
  ui.start.disabled = game.players.size === 0;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

ui.start.addEventListener('click', () => {
  if (!game.start()) return;
  ui.lobby.classList.add('hidden');
  ui.stage.classList.remove('hidden');
  ui.gameover.classList.add('hidden');
  buildTopbar();
  fitCanvas();
  broadcast({ t: 'started' });
});

ui.again.addEventListener('click', () => {
  ui.gameover.classList.add('hidden');
  game.start();
  buildTopbar();
  broadcast({ t: 'started' });
});

// -------------------------------------------------- optional keyboard hero

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

ui.localplay.addEventListener('change', () => {
  if (ui.localplay.checked) {
    if (!game.players.has(LOCAL_ID)) {
      const p = game.addPlayer(LOCAL_ID, 'HOST');
      if (!p) {
        ui.localplay.checked = false;
        ui.lobbyerr.textContent = 'No free slots for a local hero.';
        return;
      }
    }
  } else {
    game.removePlayer(LOCAL_ID);
  }
  renderSlots();
});

function pumpLocalInput() {
  if (!game.players.has(LOCAL_ID)) return;
  const k = (...names) => names.some((n) => keys.has(n));
  game.setInput(LOCAL_ID, {
    ax: (k('d', 'arrowright') ? 1 : 0) - (k('a', 'arrowleft') ? 1 : 0),
    ay: (k('s', 'arrowdown') ? 1 : 0) - (k('w', 'arrowup') ? 1 : 0),
    attack: k('j', ' ', 'spacebar'),
    dash: k('k', 'shift'),
  });
}

// ---------------------------------------------------------------- game HUD

let cards = new Map();

function buildTopbar() {
  ui.topbar.innerHTML = '';
  cards = new Map();
  for (const p of [...game.players.values()].sort((a, b) => a.slot - b.slot)) {
    const el = document.createElement('div');
    el.className = 'pcard';
    el.style.borderTopColor = p.color.t;
    el.innerHTML = `
      <div class="row1"><span class="nm"></span><span class="sc"></span></div>
      <div class="hearts"></div>`;
    el.querySelector('.nm').textContent = p.name;
    el.querySelector('.nm').style.color = p.color.t;
    ui.topbar.appendChild(el);
    cards.set(p.id, el);
  }
}

function syncTopbar(hud) {
  if (hud.players.length !== cards.size) buildTopbar();
  for (const p of hud.players) {
    const el = cards.get(p.id);
    if (!el) continue;
    el.classList.toggle('down', p.downed);
    el.querySelector('.sc').textContent =
      (p.combo > 1 ? `x${p.combo} · ` : '') + p.score + (p.connected ? '' : ' ⚠');
    const hearts = el.querySelector('.hearts');
    const need = Math.ceil(p.maxHp / 2);
    while (hearts.children.length < need) {
      const h = document.createElement('div');
      h.className = 'heart';
      hearts.appendChild(h);
    }
    for (let i = 0; i < need; i++) {
      const filled = p.hp - i * 2;
      hearts.children[i].className =
        'heart' + (filled >= 2 ? ' full' : filled === 1 ? ' half' : '');
    }
  }
}

function showGameOver(ev) {
  ui.goWave.textContent = `Wave ${ev.wave}`;
  ui.goScore.textContent = ev.score;
  ui.goRows.innerHTML = '';
  const rows = [...game.players.values()].sort((a, b) => b.score - a.score);
  for (const p of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="swatch" style="background:${p.color.t}"></span>${escapeHtml(
      p.name
    )}</td><td>${p.score}</td><td>${p.kills}</td>`;
    ui.goRows.appendChild(tr);
  }
  ui.gameover.classList.remove('hidden');
}

// -------------------------------------------------------------- main loop

function fitCanvas() {
  const wrap = ui.canvas.parentElement;
  const pad = 16;
  const sx = (wrap.clientWidth - pad) / 480;
  const sy = (wrap.clientHeight - pad) / 288;
  // Integer scaling keeps the pixel art crisp; fall back to fractional if the
  // window is too small for a clean 1x.
  const raw = Math.min(sx, sy);
  const scale = raw >= 1 ? Math.floor(raw) : raw;
  ui.canvas.style.width = `${480 * scale}px`;
  ui.canvas.style.height = `${288 * scale}px`;
}
window.addEventListener('resize', fitCanvas);

let last = performance.now();
let hudAcc = 0;
let netAcc = 0;

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  pumpLocalInput();
  game.update(dt);
  game.render(ctx);

  hudAcc += dt;
  if (hudAcc > 0.1) {
    hudAcc = 0;
    const hud = game.hudState();
    ui.sWave.textContent = hud.wave;
    ui.sLeft.textContent = hud.remaining;
    ui.sScore.textContent = hud.score;
    ui.sInter.textContent = hud.intermission ? `Next wave in ${hud.intermission}` : '';
    syncTopbar(hud);
  }

  // Controllers only need their own slice, at a modest rate.
  netAcc += dt;
  if (netAcc > 0.12) {
    netAcc = 0;
    for (const [id, conn] of conns) {
      const p = game.players.get(id);
      if (p) send(conn, game.playerState(p));
    }
  }

  requestAnimationFrame(loop);
}
