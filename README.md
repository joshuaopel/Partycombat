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
browser is the authoritative simulation** — it alone runs physics, AI and
scoring, so there is nothing to keep in sync and no way for clients to
disagree.

The world is bigger than any one screen, so **every phone is its own screen**
with its own camera following its own hero. Phones send input and receive
world snapshots at 15 Hz; they render at their own frame rate, interpolating
between the two most recent snapshots. The TV runs a director's camera that
frames the whole party, zooming out as they spread out, plus a minimap.

```
                  ┌──────────────────────────┐
   input ────────▶│  host browser            │
                  │  simulation + director   │
   snapshot ◀─────│  camera on the TV        │
   (15 Hz)        └──────────────────────────┘
        │
        ▼
   phone: own camera, own render loop, own view of the island
```

No map data crosses the wire. The host sends a four-byte seed and each phone
regenerates a byte-identical island from it.

[PeerJS](https://peerjs.com) handles signalling via its free public broker.

## Playing

1. Open the site's `host.html` on the big screen and wait for the room code.
2. Everyone opens `play.html` on their phone, enters the code and a name.
3. Host presses **Start the onslaught**.

Your phone shows your own view of the island. Drag anywhere on the left to
move, **SLASH** to attack, **DASH** for a short burst with brief
invulnerability. Arrows at the screen edge point to teammates who are off your
camera. The host screen can also seat one keyboard player (WASD/arrows,
`J`/Space to slash, `K`/Shift to dash) — handy for testing solo.

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
  Knight boss every fifth wave. Waves spawn in a ring around the party
  wherever they happen to be, so spreading out does not buy you peace.

### Playing across different networks

On one shared Wi-Fi this needs no setup: the browsers find each other directly.

Across networks it does. Phones on mobile data sit behind carrier-grade NAT,
where neither side can accept an incoming connection, so **a TURN relay is
required** — with both players on 5G there is no direct route to find and the
join fails every time. This is a property of how mobile networks work, not
something the game can code around.

There is no dependable zero-signup public relay. This project used to point at
`openrelay.metered.ca`; it has since been retired and now answers STUN
requests with an HTTP error, which is silent unless you go looking. Working
options all need a free account — [Metered](https://dashboard.metered.ca)
(~50 GB/month free), [Cloudflare](https://dash.cloudflare.com), or Twilio.

With Metered, open the dashboard, pick your app, and copy the username and
password under **TURN Server Credentials**. Try them first without committing
anything by putting them on the host URL:

```
host.html?turnhost=global.relay.metered.ca&turnuser=USER&turnpass=SECRET
```

The host's status line reads *"TURN relay configured"* when they have been
picked up, and once a phone joins you can confirm the relay is genuinely
carrying traffic: a failed join lists its ICE candidate types, and `relay`
appearing there means the TURN server answered.

Once it works, paste the same credentials into [`js/turn.js`](js/turn.js) and
commit so nobody needs the long URL.

The host forwards those into its QR code, so phones inherit them automatically.
Prefer entries on port 443 with `transport=tcp`, which survive networks that
block UDP.

### If a phone can't join

The code on the host screen is reserved fresh **every time the host page
loads**, so a reloaded host invalidates codes people are still holding. That
case now says so by name: *"No room with code ABCD"*.

A different message — *"Found room ABCD, but could not open a direct
connection"* — means the code was right and the matchmaking server found the
host, but the browsers could not open a peer-to-peer link. That is a network
problem, not a wrong code. It happens on guest Wi-Fi with client isolation, or
with one device on mobile data and the other on Wi-Fi. A public TURN relay is
configured as a fallback, but the reliable fix is putting every device on the
same Wi-Fi network.

### If someone drops

Phones that go quiet for five seconds are marked offline; their hero stops
being targeted and stops counting toward "everyone is down". Rejoining with
the **same name** reclaims the original slot and colour. Players can also join
mid-run — they drop straight into the current wave.

## Deploying to GitHub Pages

**Settings → Pages → Source → Deploy from a branch**, then pick `main` and
`/ (root)`. That is the whole setup: there is no build step, and `.nojekyll`
stops Pages from mangling the directory layout. The site appears at
`https://<user>.github.io/<repo>/` after a minute or so.

`.github/workflows/pages.yml` is an Actions-based alternative, left on
`workflow_dispatch` so it only runs when you ask for it. It needs
**Settings → Actions → General → Workflow permissions** set to *Read and
write*; without that, `configure-pages` fails with *"Resource not accessible
by integration"* because the job's token cannot touch Pages. Branch deploys
need none of that, which is why they are the default advice here.

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

### The world

The island is 2400x1440 — about five screens across — generated procedurally
in [`js/world.js`](js/world.js) from value noise, with an elevation falloff at
the edges that turns the map into a bounded island. Terrain boundaries are
stippled with per-tile jitter rather than stepping along hard 16px edges.
Trees clump into woods where a separate noise field is high.

Ground tiles are sampled from the assembled Light World map — they are the
game's real terrain tiles, taken in context — and props (the big round trees,
boulders, bushes, stumps) come from the Overworld Tiles sheet. The ground is
baked once to an offscreen canvas and each camera blits a sub-rect of it,
which costs one `drawImage` per frame regardless of world size.

Props are *not* baked. They join the depth sort with players and enemies, so a
hero standing north of a tree is drawn behind its canopy rather than on top of
it. A canopy that would completely swallow a hero fades to 45% — without that
you can lose track of yourself entirely while standing next to a tree.

Every prop carries a minimum spacing (60px for trees, which are 64px wide) so
canopies never overlap and a wood reads as individual trees. Blocking radii are
sized to each prop's base rather than its silhouette.

Collision is axis-separated so bodies slide along a shoreline or a tree
instead of sticking to it. Water is the only impassable terrain; solid props
are circles bucketed into a uniform grid.

### Rebuilding the atlas

`tools/build_atlas.py` regenerates `assets/sprites.{png,json}`. It needs the
source sheets, which are deliberately not in the repo — download them from the
TSR link above into the same directory as the script:

```
link_sheet.png              Link
sheets/lightworld.png       Minor Light World Enemies  (Octorok, Keese)
sheets/stalfos.png          Stalfos
sheets/moblin.png           Taros & Moblin
sheets/armos.png            Armos Knights
sheets/overworld.png        Overworld Tiles            (trees, rocks, bushes)
sheets/lightworld_map.png   Light World                (ground tiles)
```

Then:

```sh
pip install pillow numpy scipy
PCBT_SHEETS=/path/to/sheets python3 tools/build_atlas.py   # characters
PCBT_SHEETS=/path/to/sheets python3 tools/build_world.py   # terrain + props
```

Both scripts locate frames by flood-filling away each sheet's background
colour, so they do not depend on hand-typed pixel coordinates. Ground tiles
were chosen by frequency-scanning the Light World map on its 16px grid and
keeping the most common terrain.

Props need two flood-fill passes, because they are ripped on two nested
backgrounds: a square of overworld grass, itself on the sheet's white. The
white goes first; the grass palette is then read off the biggest prop's outer
ring and cleared everywhere. Leaving the grass in would paint bright green
rectangles over whatever a prop is placed on.

## Layout

```
index.html          landing page — host or join
host.html           big screen: lobby, arena, scoreboard
play.html           phone controller
assets/sprites.*    character atlas + frame metadata
assets/world.*      terrain tiles and props + metadata
js/sprites.js       atlas loading, mail recolouring, drawing helpers
js/world.js         island generation, baking, collision, spawn points
js/render.js        camera + the one copy of the scene drawing code
js/scene.js         client-side snapshot decoding and interpolation
js/enemies.js       enemy archetypes (AI) and the wave curve
js/game.js          authoritative simulation, scene building, snapshots
js/net.js           PeerJS transport, ICE configuration, join diagnostics
js/turn.js          TURN relay credentials (needed only across networks)
js/host.js          host wiring: lobby, director camera, minimap, main loop
js/play.js          phone wiring: world view, touch stick, buttons, HUD
tools/build_atlas.py  slices character frames out of the reference sheets
tools/build_world.py  slices terrain tiles and props
tests/sim.html      headless assertions over the simulation
tests/sprites.html  renders every frame for eyeballing art
tests/world.html    generates an island and shows it whole and at 1:1
```

## Tests

Open `tests/sim.html` in a browser — it runs 54 assertions against the
simulation (combat resolves, waves advance and escalate, downing, revival and
bleedout, six-player seating, world collision, shoreline sliding, prop spacing
and solidity, seed determinism, and snapshot encode/decode round-tripping) and
prints pass/fail. Every case runs on a fixed seed so the suite is
deterministic.

`tests/sprites.html` renders every frame of every mail colour and enemy.
`tests/world.html` generates an island and shows it both whole and at 1:1;
pass `?seed=N` to try a different one.
