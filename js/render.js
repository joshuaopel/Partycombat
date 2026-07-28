// Shared scene renderer.
//
// The host draws from its live simulation; phones draw from the snapshots the
// host sends. Both funnel through drawScene so there is exactly one copy of
// the drawing code and the two views can't drift apart.

import { heroSheet, enemyFrames, prop, drawAt, drawGrounded, drawSword } from './sprites.js';

export const DIR_ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

/** A camera looking at a rect of the world, drawn into a viewport of w x h. */
export class Camera {
  constructor(w, h, zoom = 1) {
    this.x = 0;
    this.y = 0;
    this.w = w;
    this.h = h;
    this.zoom = zoom;
  }

  resize(w, h, zoom = this.zoom) {
    this.w = w;
    this.h = h;
    this.zoom = zoom;
  }

  /** Centre on a point, clamped so the view never leaves the world. */
  centreOn(x, y, world) {
    const vw = this.w / this.zoom;
    const vh = this.h / this.zoom;
    this.x = Math.max(0, Math.min(world.w - vw, x - vw / 2));
    this.y = Math.max(0, Math.min(world.h - vh, y - vh / 2));
    if (world.w < vw) this.x = (world.w - vw) / 2;
    if (world.h < vh) this.y = (world.h - vh) / 2;
  }

  /** Ease toward a point instead of snapping, so the view doesn't jitter. */
  followSmooth(x, y, world, dt, rate = 9) {
    const vw = this.w / this.zoom;
    const vh = this.h / this.zoom;
    const tx = Math.max(0, Math.min(Math.max(0, world.w - vw), x - vw / 2));
    const ty = Math.max(0, Math.min(Math.max(0, world.h - vh), y - vh / 2));
    const k = 1 - Math.exp(-rate * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
  }

  get viewW() {
    return this.w / this.zoom;
  }

  get viewH() {
    return this.h / this.zoom;
  }

  visible(x, y, pad = 48) {
    return (
      x > this.x - pad && x < this.x + this.viewW + pad &&
      y > this.y - pad && y < this.y + this.viewH + pad
    );
  }
}

function shadow(ctx, x, y, r) {
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(ctx, p, opts) {
  const sheet = heroSheet(p.slot);
  const set = p.downed ? sheet.downed : sheet;
  const key = p.dir === 'left' || p.dir === 'right' ? 'side' : p.dir;
  const strip = set[key] || set.down;
  const cv = strip[p.frame % strip.length];
  // Source side frames face left, so mirror for right.
  const flip = p.dir === 'right';
  const ground = p.y + 7;

  shadow(ctx, p.x, ground, 6);

  if (p.downed) {
    ctx.save();
    ctx.translate(p.x, ground);
    ctx.rotate(Math.PI / 2);
    drawAt(ctx, cv, 0, 0, sheet.foot, { alpha: 0.85 });
    ctx.restore();
    const pct = p.reviveProgress || 0;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(p.x - 11, p.y - 15, 22, 4);
    ctx.fillStyle = pct > 0 ? '#7dfc9a' : '#e2453c';
    ctx.fillRect(p.x - 10, p.y - 14, 20 * (pct > 0 ? pct : p.bleed ?? 1), 2);
  } else {
    const blink = p.invuln > 0 && Math.floor(p.invuln * 16) % 2 === 0;
    if (!blink) {
      drawAt(ctx, cv, p.x, ground, sheet.foot, {
        flip,
        tint: p.flash > 0 ? 'rgba(255,80,80,0.55)' : null,
      });
    }
    if (p.atkT > 0) {
      const a = p.atkAngle;
      drawSword(ctx, p.x + Math.cos(a) * 7, p.y + Math.sin(a) * 7 + 1, a + Math.PI / 2);
    }
  }

  if (opts.names) {
    ctx.font = 'bold 7px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillText(p.name, p.x + 1, p.y - 15);
    ctx.fillStyle = opts.highlight === p.id ? '#ffffff' : sheet.color.t;
    ctx.fillText(p.name, p.x, p.y - 16);
    if (opts.highlight === p.id) {
      // A small caret so you can always find yourself in a crowd.
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 20);
      ctx.lineTo(p.x - 3, p.y - 25);
      ctx.lineTo(p.x + 3, p.y - 25);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawEnemy(ctx, e) {
  const frames = enemyFrames(e.type);
  const cv = frames[e.frame % frames.length];
  const scale = e.scale || 1;
  const hover = e.type === 'bat' ? Math.sin(e.bob || 0) * 2.5 - 3 : 0;
  const ground = e.y + (e.radius || 8) * 0.9;

  shadow(ctx, e.x, ground, 6 * scale);

  ctx.save();
  if (e.alpha !== undefined && e.alpha !== 1) ctx.globalAlpha = e.alpha;
  if (scale !== 1) {
    ctx.translate(e.x, ground);
    ctx.scale(scale, scale);
    ctx.translate(-e.x, -ground);
  }
  drawGrounded(ctx, cv, e.x, ground + hover, {
    flip: e.face === 'l',
    tint: e.flash > 0 ? 'rgba(255,255,255,0.75)' : e.winding ? 'rgba(255,60,60,0.45)' : null,
  });
  ctx.restore();

  if (e.boss) {
    const w = 60;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(e.x - w / 2 - 1, e.y - 34, w + 2, 6);
    ctx.fillStyle = '#e2453c';
    ctx.fillRect(e.x - w / 2, e.y - 33, w * Math.max(0, e.hp / e.maxHp), 4);
  }
}

/**
 * Draw one camera's view of the world and everything in it.
 * `scene` holds plain objects, so it works for both the live simulation and a
 * decoded network snapshot.
 */
export function drawScene(ctx, world, cam, scene, opts = {}) {
  const { names = true, highlight = null, shake = 0 } = opts;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  if (cam.zoom !== 1) ctx.scale(cam.zoom, cam.zoom);
  let ox = -cam.x;
  let oy = -cam.y;
  if (shake > 0.2) {
    ox += (Math.random() - 0.5) * shake;
    oy += (Math.random() - 0.5) * shake;
  }
  ctx.translate(Math.round(ox), Math.round(oy));

  // Ground + baked props.
  const vw = cam.viewW;
  const vh = cam.viewH;
  const sx = Math.max(0, Math.floor(cam.x));
  const sy = Math.max(0, Math.floor(cam.y));
  const sw = Math.min(world.w - sx, Math.ceil(vw) + 2);
  const sh = Math.min(world.h - sy, Math.ceil(vh) + 2);
  if (sw > 0 && sh > 0) ctx.drawImage(world.bake(), sx, sy, sw, sh, sx, sy, sw, sh);

  // Anything beyond the island edge reads as open sea.
  ctx.fillStyle = '#3860a8';
  if (cam.x < 0) ctx.fillRect(cam.x, cam.y, -cam.x, vh);
  if (cam.y < 0) ctx.fillRect(cam.x, cam.y, vw, -cam.y);

  for (const k of scene.pickups || []) {
    if (!cam.visible(k.x, k.y)) continue;
    shadow(ctx, k.x, k.y + 5, 5);
    const cv = prop(k.kind);
    ctx.drawImage(cv, Math.round(k.x - cv.width / 2), Math.round(k.y - cv.height / 2 + Math.sin(k.bob || 0) * 2));
  }

  for (const p of scene.rings || []) {
    ctx.save();
    ctx.globalAlpha = p.a * 0.8;
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Depth sort so sprites overlap correctly.
  const drawables = [];
  for (const e of scene.enemies || []) if (cam.visible(e.x, e.y)) drawables.push({ y: e.y, e });
  for (const p of scene.players || []) if (cam.visible(p.x, p.y)) drawables.push({ y: p.y, p });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) {
    if (d.e) drawEnemy(ctx, d.e);
    else drawPlayer(ctx, d.p, { names, highlight });
  }

  for (const s of scene.shots || []) {
    if (!cam.visible(s.x, s.y)) continue;
    const cv = prop(s.kind === 'bolt' ? 'bolt' : 'rock');
    ctx.drawImage(cv, Math.round(s.x - cv.width / 2), Math.round(s.y - cv.height / 2));
  }

  for (const p of scene.particles || []) {
    ctx.globalAlpha = p.a;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;

  for (const f of scene.floaters || []) {
    ctx.globalAlpha = Math.min(1, f.a);
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1a1420';
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/**
 * Arrows at the screen edge pointing at teammates who are off-camera, so a
 * spread-out party can still find each other in a world this size.
 */
export function drawOffscreenMarkers(ctx, cam, players, selfId) {
  const vw = cam.w;
  const vh = cam.h;
  const pad = 14;
  for (const p of players) {
    if (p.id === selfId) continue;
    const sx = (p.x - cam.x) * cam.zoom;
    const sy = (p.y - cam.y) * cam.zoom;
    if (sx > 0 && sx < vw && sy > 0 && sy < vh) continue;
    const cx = vw / 2;
    const cy = vh / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const rx = Math.min(cx - pad, Math.abs(Math.cos(ang)) > 1e-3 ? Math.abs((cx - pad) / Math.cos(ang)) : 1e9);
    const ry = Math.min(cy - pad, Math.abs(Math.sin(ang)) > 1e-3 ? Math.abs((cy - pad) / Math.sin(ang)) : 1e9);
    const r = Math.min(rx, ry);
    const ax = cx + Math.cos(ang) * r;
    const ay = cy + Math.sin(ang) * r;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = heroSheet(p.slot).color.t;
    ctx.globalAlpha = p.downed ? 0.5 : 1;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
