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
- Enemies escalate: Octoroks (ranged) → Moblins (lunging melee) → Keese (fast,
  erratic) → Stalfos (tanky) → Taros (teleporting casters), with an Armos
  Knight boss every fifth wave.

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

Sprites are sliced from *A Link to the Past* reference sheets published on
[The Spriters Resource](https://www.spriters-resource.com/snes/legendofzeldaalinktothepast/)
— Link ripped by Mister Man, the enemy sheets by Barack Obama (the TSR user).
The characters are Nintendo's.

`assets/sprites.png` is a 7 KB atlas holding **only the frames this game
draws**: three eight-frame walk cycles for the hero, two frames for each enemy,
and one for the boss. The upstream sheets are not redistributed here — the
Link sheet in particular carries a "please do not steal / only for TSR" notice
from its ripper, and packing just the needed frames respects that while also
being the right call technically (7 KB instead of ~300 KB of sheets).

Heroes recolour per player by remapping the five palette entries that the game
itself swaps between green, blue and red mail. Blue and red use Nintendo's own
values, read straight off the reference sheet's palette strip; violet, amber
and cyan follow the same structure — a contrasting cap accent over a distinct
tunic — so six players stay tellable apart at a glance. Pickups, projectiles
and the swing sword are original pixel art in `js/sprites.js`, since they are
icons rather than characters.

The arena is generated procedurally in [`js/arena.js`](js/arena.js) and baked
once to an offscreen canvas.

### Rebuilding the atlas

`tools/build_atlas.py` regenerates `assets/sprites.{png,json}`. It needs the
source sheets, which are deliberately not in the repo — download them from the
TSR link above into the same directory as the script:

```
link_sheet.png          Link
sheets/lightworld.png   Minor Light World Enemies  (Octorok, Keese)
sheets/stalfos.png      Stalfos
sheets/moblin.png       Taros & Moblin
sheets/armos.png        Armos Knights
```

Then `pip install pillow numpy scipy && python3 tools/build_atlas.py`. The
script finds frames by flood-filling away each sheet's background colour, so it
does not depend on hand-typed pixel coordinates.

## Layout

```
index.html          landing page — host or join
host.html           big screen: lobby, arena, scoreboard
play.html           phone controller
assets/sprites.png  packed sprite atlas (built by tools/build_atlas.py)
assets/sprites.json frame rectangles and hero metrics
js/sprites.js       atlas loading, mail recolouring, drawing helpers
js/arena.js         procedural arena, collision, spawn points
js/enemies.js       enemy archetypes (AI) and the wave curve
js/game.js          authoritative simulation and rendering
js/net.js           PeerJS transport
js/host.js          host wiring: lobby, connections, main loop
js/play.js          controller wiring: touch stick, buttons, HUD
tools/build_atlas.py
                    slices the reference sheets into the atlas
tests/sim.html      headless assertions over the simulation
tests/sprites.html  renders every frame for eyeballing art
```

## Tests

Open `tests/sim.html` in a browser — it runs 30 assertions against the
simulation (combat resolves, waves advance and escalate, downing, revival and
bleedout, six-player seating, arena collision) and prints pass/fail.
`tests/sprites.html` renders every frame of every mail colour and enemy, which
is the fastest way to check art changes.
