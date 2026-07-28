// On-screen controls, shared by the phone and the host screen.
//
// The phone has always had a drag-anywhere stick and two action buttons. The
// host has one too now — a laptop with a trackpad or a touchscreen is a
// perfectly good seat at the table, and "learn these five keys first" is a
// poor greeting for the one person who was already doing the work of hosting.
//
// Pointer events rather than touch events, so one code path covers a thumb, a
// mouse and a finger on a touchscreen. `pointerId` gives the same multi-touch
// tracking that touch identifiers did, so holding the stick and hitting SLASH
// at the same time still works.

/**
 * Turn a region into a drag stick. The stick spawns wherever the press lands
 * rather than sitting in a fixed spot, so nobody has to look down to find it.
 * Returns `{ active }` — true while a press is being tracked, which lets a
 * caller prefer the stick over the keyboard without the two fighting.
 */
export function bindStick(zone, stick, knob, { radius = 56, onChange }) {
  let id = null;
  let ox = 0;
  let oy = 0;

  const move = (e) => {
    if (e.pointerId !== id) return;
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const d = Math.hypot(dx, dy);
    if (d > radius) {
      dx = (dx / d) * radius;
      dy = (dy / d) * radius;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Small deadzone so a resting thumb doesn't drift the hero.
    const norm = Math.min(1, d / radius);
    if (norm < 0.16) {
      onChange(0, 0);
    } else {
      const k = Math.hypot(dx, dy) || 1;
      onChange((dx / k) * norm, (dy / k) * norm);
    }
  };

  const end = (e) => {
    if (e.pointerId !== id) return;
    try {
      zone.releasePointerCapture(id);
    } catch {
      /* already gone */
    }
    id = null;
    stick.classList.remove('on');
    knob.style.transform = 'translate(0,0)';
    onChange(0, 0);
  };

  zone.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault();
    id = e.pointerId;
    // Capturing means a drag that leaves the zone keeps steering, and the
    // release always lands here — no stuck stick when a thumb slides off.
    try {
      zone.setPointerCapture(id);
    } catch {
      /* not supported; the window-level handlers below still cover it */
    }
    ox = e.clientX;
    oy = e.clientY;
    const r = zone.getBoundingClientRect();
    stick.style.left = `${e.clientX - r.left}px`;
    stick.style.top = `${e.clientY - r.top}px`;
    stick.classList.add('on');
    move(e);
  });
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);

  return { active: () => id !== null };
}

/**
 * An action button. Held state is tracked per pointer, so a second finger
 * landing on an already-held button cannot release it early.
 */
export function bindButton(el, onDown, onUp) {
  const held = new Set();

  const up = (e) => {
    if (!held.delete(e.pointerId)) return;
    if (held.size) return;
    el.classList.remove('held');
    onUp();
  };

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* fine; pointerup still arrives */
    }
    held.add(e.pointerId);
    el.classList.add('held');
    onDown();
  });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
