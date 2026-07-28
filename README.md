# Partycombat

A Jackbox-style co-op wave defence game for up to six players. Put the host
screen on a TV, laptop or monitor; everyone else joins from their phone by
typing a four-letter room code (or scanning the QR). Heroes hold a walled
arena against escalating waves of enemies, with a boss every fifth wave.

Personal, non-commercial project. Static site — it runs entirely on
GitHub Pages with no backend.

## How it works

There is no game server. The host page opens a WebRTC peer whose id is
derived from the room code, and each phone dials that id directly. **The host
browser is the authoritative simulation**: phones only ever send input
(stick direction, slash, dash) and receive back their own HUD slice. That
keeps the phones dumb, avoids any state divergence, and means the whole thing
is hostable from static files.

[PeerJS](https://peerjs.com) handles signalling via its free public broker.

```
phone ──input──▶  host browser  ──HUD state──▶ phone
                  (game loop, physics, AI, scoring)
```

## Playing

1. Open the site's `host.html` on the big screen and wait for the room code.
2. Everyone opens `play.html` on their phone, enters the code and a name.
3. Host presses **Start the onslaught**.

Controls on the phone: drag anywhere on the left to move, **SLASH** to attack,
**DASH** for a short burst with brief invulnerability. The host screen can
also seat one keyboard player (WASD/arrows, `J`/Space to slash, `K`/Shift to
dash) — handy for testing solo.

Landscape is more comfortable, but portrait works.

### Rules

- Three hearts each. Take enough damage and you go **down** rather than die.
- A downed hero bleeds out over 22 seconds. Any teammate standing over them
  revives them — two teammates revive twice as fast.
- The run ends when every connected hero is down at once.
- Clearing a wave drops hearts and pays a bonus. Consecutive kills build a
  score multiplier that resets when you take a hit.
- Enemies escalate: Octos (ranged) → Grunts (lunging melee) → Keese (fast,
  erratic) → Stalfos (tanky) → Wizzrobes (teleporting casters), with the Iron
  Captain boss every fifth wave.

### If someone drops

Phones that go quiet for five seconds are marked offline; their hero stops
being targeted and stops counting toward "everyone is down". Rejoining with
the **same name** reclaims the original slot and colour. Players can also join
mid-run — they drop straight into the current wave.

## Deploying to GitHub Pages

Either enable Pages from the repository settings (**Settings → Pages → Deploy
from a branch → `main` / `/root`**), or use the included workflow at
`.github/workflows/pages.yml`, which publishes the repository root on every
push to `main`. There is no build step. `.nojekyll` keeps Pages from
mangling the directory layout.

Both pages must be served over **HTTPS** for WebRTC to work — Pages already
is. Opening the files directly with `file://` will not work; ES modules need
a real origin. Locally, use any static server:

```sh
python3 -m http.server 8000    # then visit http://localhost:8000
```

### Using your own PeerServer

The free PeerJS broker is occasionally rate-limited. To point at your own,
append the connection details to the URL on **both** the host and the phones
(the host propagates them into its QR link automatically):

```
host.html?host=peer.example.com&port=443&path=/&secure=1
```

## Artwork

All sprites are original pixel art written by hand in
[`js/sprites.js`](js/sprites.js) as indexed-colour character grids — an
homage to the 16-bit Zelda look, not ripped assets. Each character maps to a
palette entry, so a hero's cap and tunic recolour per player by swapping two
entries while skin, hair and boots stay put. The arena is generated
procedurally in [`js/arena.js`](js/arena.js) and baked once to an offscreen
canvas.

## Layout

```
index.html          landing page — host or join
host.html           big screen: lobby, arena, scoreboard
play.html           phone controller
js/sprites.js       pixel art data, palette swapping, rasterising
js/arena.js         procedural arena, collision, spawn points
js/enemies.js       enemy archetypes (AI) and the wave curve
js/game.js          authoritative simulation and rendering
js/net.js           PeerJS transport
js/host.js          host wiring: lobby, connections, main loop
js/play.js          controller wiring: touch stick, buttons, HUD
tests/sim.html      headless assertions over the simulation
tests/sprites.html  renders every sprite at 6x for eyeballing art
```

## Tests

Open `tests/sim.html` in a browser — it runs 27 assertions against the
simulation (combat resolves, waves advance and escalate, downing and revival,
six-player seating, arena collision) and prints pass/fail. `tests/sprites.html`
renders every frame at 6x, which is the fastest way to check art changes.
