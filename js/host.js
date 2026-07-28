// Host screen: owns the peer, the lobby, the simulation and the big display.

import { startHost, send, MAX_PLAYERS } from './net.js';
import { hasTurn } from './turn.js';
import { Game } from './game.js';
import { heroSheet, loadSprites, PLAYER_COLORS } from './sprites.js';
import { loadWorldArt } from './world.js';
import { Camera, drawScene } from './render.js';

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
  goMvp: $('go-mvp'),
  sbRows: $('sb-rows'),
  again: $('again'),
  status: $('status'),
  mmCanvas: $('minimap'),
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

// The lobby and the render loop both need the sprite atlas. The room code
// arrives separately, so a slow CDN never leaves a dead screen.
Promise.all([loadSprites(), loadWorldArt()]).then(
  () => {
    game.world.bake();
    buildMinimap();
    renderSlots();
    requestAnimationFrame(loop);
  },
  (err) => {
    ui.lobbyerr.textContent = err.message || String(err);
  }
);

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
    // Same Wi-Fi is the requirement, so say it on the screen everyone is
    // already looking at while they type the code.
    setStatus(hasTurn() ? 'room open · relay configured' : 'room open · everyone on the same Wi-Fi');
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
  // Carry any custom PeerServer and TURN settings through to the phones —
  // every device has to agree on both or they cannot meet.
  for (const k of ['host', 'port', 'path', 'secure', 'turnhost', 'turnuser', 'turnpass']) {
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
        seed: game.seed,
      });
      broadcastRoster();
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
    broadcastRoster();
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

/** Names and colours keyed by slot; snapshots then only carry slot numbers. */
function broadcastRoster() {
  const list = [...game.players.values()].map((p) => ({ slot: p.slot, id: p.id, name: p.name }));
  broadcast({ t: 'roster', players: list });
}

function handleGameEvent(ev) {
  switch (ev.t) {
    case 'hurt':
    case 'downed':
    case 'revived':
    case 'heal':
    case 'weapon':
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
  const src = heroSheet(slot).down[0];
  const cv = document.createElement('canvas');
  cv.width = src.width * 2;
  cv.height = src.height * 2;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(src, 0, 0, cv.width, cv.height);
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
      <div class="hearts"></div>
      <span class="wp"></span>`;
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
    const wp = el.querySelector('.wp');
    // Seconds left, not a bar: you need to know whether to spend it now.
    wp.textContent = p.weapon ? `${p.weaponTag} ${p.weaponSecs}s` : '';
    wp.className = 'wp' + (p.weapon ? ' on' : '');
    wp.style.color = p.weaponColor || 'transparent';
  }
  syncScoreboard(hud.standings);
}

// Rows are kept and reordered rather than rebuilt, so a lead change slides
// instead of flickering the whole panel every tenth of a second.
const sbRows = new Map();

function syncScoreboard(standings) {
  for (const p of standings) {
    let li = sbRows.get(p.id);
    if (!li) {
      li = document.createElement('li');
      li.innerHTML = '<span class="rk"></span><span class="dot"></span>' +
        '<span class="who"></span><span class="pts"></span>';
      li.querySelector('.dot').style.background = p.color;
      li.querySelector('.who').textContent = p.name;
      sbRows.set(p.id, li);
    }
    li.className = (p.downed ? 'down' : '') + (p.rank === 1 && p.score > 0 ? ' lead' : '');
    li.querySelector('.rk').textContent = p.rank;
    li.querySelector('.pts').innerHTML =
      `${p.score}<small>${p.kills}k</small>`;
    ui.sbRows.appendChild(li); // appending an existing node moves it
  }
  for (const [id, li] of sbRows) {
    if (!standings.some((p) => p.id === id)) {
      li.remove();
      sbRows.delete(id);
    }
  }
}

function showGameOver(ev) {
  ui.goWave.textContent = `Wave ${ev.wave}`;
  ui.goScore.textContent = ev.score;
  ui.goRows.innerHTML = '';
  const rows = game.standings();
  for (const p of rows) {
    const tr = document.createElement('tr');
    if (p.rank === 1) tr.className = 'first';
    tr.innerHTML =
      `<td>${p.rank}</td>` +
      `<td><span class="swatch" style="background:${p.color}"></span>${escapeHtml(p.name)}</td>` +
      `<td>${p.score}</td><td>${p.kills}</td><td>${p.bestCombo > 1 ? `x${p.bestCombo}` : '—'}</td>`;
    ui.goRows.appendChild(tr);
  }
  // Naming the winner out loud is most of why anyone looks at a scoreboard.
  const top = rows[0];
  ui.goMvp.innerHTML =
    top && top.score > 0
      ? `Top hero: <b style="color:${top.color}">${escapeHtml(top.name)}</b> — ${top.score} points, ${top.kills} kills`
      : '';
  ui.gameover.classList.remove('hidden');
}

// -------------------------------------------------------------- main loop

// The TV is a director's view: it frames the whole party, zooming out as they
// spread across the island, so spectators always see everyone.
const HOST_W = 640;
const HOST_H = 384;
const cam = new Camera(HOST_W, HOST_H, 1);
let minimap = null;

function buildMinimap() {
  minimap = game.world.minimap(1 / 14);
  ui.mmCanvas.width = minimap.width;
  ui.mmCanvas.height = minimap.height;
}

function updateDirectorCamera(dt) {
  const live = game.activePlayers();
  if (!live.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of live) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const pad = 150;
  const wantZoom = Math.max(
    0.45,
    Math.min(1.6, Math.min(HOST_W / (x1 - x0 + pad), HOST_H / (y1 - y0 + pad)))
  );
  // Ease the zoom so a sprinting player doesn't snap the whole view.
  cam.zoom += (wantZoom - cam.zoom) * (1 - Math.exp(-3 * dt));
  cam.followSmooth((x0 + x1) / 2, (y0 + y1) / 2, game.world, dt, 4);
}

function drawMinimap() {
  if (!minimap) return;
  const c = ui.mmCanvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.globalAlpha = 0.85;
  c.drawImage(minimap, 0, 0);
  c.globalAlpha = 1;
  const sx = minimap.width / game.world.w;
  const sy = minimap.height / game.world.h;
  // Camera rect.
  c.strokeStyle = 'rgba(255,255,255,0.7)';
  c.lineWidth = 1;
  c.strokeRect(cam.x * sx, cam.y * sy, cam.viewW * sx, cam.viewH * sy);
  for (const e of game.enemies) {
    c.fillStyle = e.def.boss ? '#ffd24a' : 'rgba(230,80,70,0.9)';
    c.fillRect(e.x * sx - 1, e.y * sy - 1, e.def.boss ? 4 : 2, e.def.boss ? 4 : 2);
  }
  for (const p of game.activePlayers()) {
    c.fillStyle = p.downed ? '#555' : p.color.t;
    c.fillRect(p.x * sx - 2, p.y * sy - 2, 4, 4);
  }
}

function fitCanvas() {
  const wrap = ui.canvas.parentElement;
  const pad = 16;
  // The director view is for spectating, not precise play, so fill the screen
  // rather than snapping to integer scales. Phones keep integer zoom, where
  // crispness actually matters.
  const scale = Math.min((wrap.clientWidth - pad) / HOST_W, (wrap.clientHeight - pad) / HOST_H);
  ui.canvas.style.width = `${Math.round(HOST_W * scale)}px`;
  ui.canvas.style.height = `${Math.round(HOST_H * scale)}px`;
}
window.addEventListener('resize', fitCanvas);

function drawBanner(c) {
  const b = game.banner;
  if (!b) return;
  c.save();
  c.globalAlpha = Math.min(1, b.t / 0.4);
  c.textAlign = 'center';
  c.fillStyle = 'rgba(10,8,16,0.72)';
  c.fillRect(0, HOST_H / 2 - 26, HOST_W, 44);
  c.fillStyle = '#ffd24a';
  c.font = 'bold 20px monospace';
  c.fillText(b.text, HOST_W / 2, HOST_H / 2 - 4);
  c.fillStyle = '#e8e4d8';
  c.font = '9px monospace';
  c.fillText(b.sub, HOST_W / 2, HOST_H / 2 + 11);
  c.restore();
}

let last = performance.now();
let hudAcc = 0;
let netAcc = 0;
let youAcc = 0;
const SNAP_HZ = 15;

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  pumpLocalInput();
  game.update(dt);

  updateDirectorCamera(dt);
  ctx.clearRect(0, 0, HOST_W, HOST_H);
  drawScene(ctx, game.world, cam, game.scene(), { names: true, shake: game.shakeAmt });
  drawBanner(ctx);
  drawMinimap();

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

  // World snapshots drive every phone's own camera and rendering.
  netAcc += dt;
  if (netAcc > 1 / SNAP_HZ) {
    netAcc = 0;
    // Always drain, so queued effects can't go stale for a late joiner.
    const snap = game.snapshot();
    for (const c of conns.values()) send(c, snap);
  }

  // Personal HUD numbers change slowly; they don't need the snapshot rate.
  youAcc += dt;
  if (youAcc > 0.15) {
    youAcc = 0;
    for (const [id, conn] of conns) {
      const p = game.players.get(id);
      if (p) send(conn, game.playerState(p));
    }
  }

  requestAnimationFrame(loop);
}
