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

Put every device — the big screen and every phone — on the **same Wi-Fi**. The
browsers connect to each other directly over the LAN, so mobile data will not
work. See [below](#everyone-on-the-same-wi-fi) for why.

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
- **Killing an enemy pays the hero who landed the blow** — sword, arrow or
  fireball, whoever finished it banks the points and the kill. The team total
  goes up either way, so a scoreboard exists without the game turning into a
  race to steal kills.
- **Loot keeps landing** while a wave runs, out where you have to go and get
  it: hearts to heal two hit points, rupees for points, and weapon upgrades.
  Bosses always drop a heart and a weapon; every wave clear leaves both too.
- Enemies escalate: Octoroks (ranged) → Moblins (lunging melee) → Keese (fast,
  erratic) → Stalfos (tanky) → Taros (teleporting casters), with an Armos
  Knight boss every fifth wave. Waves spawn in a ring around the party
  wherever they happen to be, so spreading out does not buy you peace.

### Weapons

You always keep your sword. A weapon pickup layers something on top of it for
**22 seconds** rather than swapping your attack out — nobody wants to sprint
across the island for a power-up and find it made them worse. Picking up a
second one replaces the first, and the clock pauses while you are down, so
bleeding out is not also a weapon tax.

| | |
|---|---|
| **Master Sword** | Hits for two, reaches further, and every swing throws a beam that carries on through the line |
| **Bow** | An arrow on each swing: fast, three damage, single target, and it kills an Octorok before it can spit |
| **Boomerang** | Flies out and comes home, hitting everything in the lane both ways and shoving it hard. One in the air at a time |
| **Fire Rod** | A slow fireball that explodes where it lands. It does not care how many of them are standing together |

Everyone can see who is holding what: the weapon tags your name in the world,
sits on your card on the TV with its countdown, and shows on your own phone.

### The scoreboard

The TV carries a live ranked board — score, kills, and who is in the lead —
next to the arena, and your phone shows where you sit in the party. When the
run ends, both show the full standings with kills and each hero's best kill
streak, and the TV names the top hero.

Ties break on kills and then on seat, so two heroes drawing level never makes
the board flicker between them.

### Everyone on the same Wi-Fi

**This is a same-Wi-Fi game.** The host screen and every phone join the same
wireless network, and the browsers open a direct link over the LAN. There is no
setup beyond that — no accounts, no relay, no configuration.

Mobile data will not work, and neither will a mix of one device on Wi-Fi and
another on 5G. Phones on mobile data sit behind carrier-grade NAT, where
neither side can accept an incoming connection, so there is no direct route to
find. Bridging that gap needs a TURN relay that bounces every byte of gameplay
traffic through a rented server — an account, credentials baked into a public
page, a bandwidth quota, and a fresh failure mode that looks exactly like an
ordinary network problem. For a game where everyone is in the same room anyway,
requiring one Wi-Fi is the better trade. [`js/turn.js`](js/turn.js) is
deliberately empty.

Guest networks are the one same-Wi-Fi case that can still fail: many of them
enable *client isolation*, which blocks devices on the network from talking to
each other at all. If a join fails on shared Wi-Fi, that is usually why.

<details>
<summary>Escape hatch: playing across networks anyway</summary>

If you really do want to play across networks, pass a TURN relay's details on
the host URL — the host forwards them into its QR code, so phones inherit them:

```
host.html?turnhost=global.relay.metered.ca&turnuser=USER&turnpass=SECRET
```

[Metered](https://dashboard.metered.ca) (~50 GB/month free),
[Cloudflare](https://dash.cloudflare.com) and Twilio all have free tiers;
Metered's credentials are under **TURN Server Credentials** in the dashboard.
The host's status line reads *"relay configured"* once they are picked up, and
a failed join lists its ICE candidate types — `relay` appearing there means the
TURN server actually answered.

Credentials on a URL are visible to anyone who scans the QR. That is
unavoidable for browser WebRTC, and is part of why this is not the default.

</details>

### If a phone can't join

The code on the host screen is reserved fresh **every time the host page
loads**, so a reloaded host invalidates codes people are still holding. That
case says so by name: *"No room with code ABCD"*.

A different message — *"Found room ABCD, but could not reach the host"* — means
the code was right and the matchmaking server found the host, but the two
browsers could not open a link. That is a network problem, not a wrong code:
someone is on mobile data, on a different Wi-Fi, or on a guest network with
client isolation. Put every device on one Wi-Fi.

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
js/weapons.js       weapon upgrades and what each one does to a swing
js/game.js          authoritative simulation, scene building, snapshots
js/net.js           PeerJS transport, ICE configuration, join diagnostics
js/turn.js          empty by design — why this is a same-Wi-Fi game
js/host.js          host wiring: lobby, director camera, minimap, main loop
js/play.js          phone wiring: world view, touch stick, buttons, HUD
tools/build_atlas.py  slices character frames out of the reference sheets
tools/build_world.py  slices terrain tiles and props
tests/sim.html      headless assertions over the simulation
tests/sprites.html  renders every frame for eyeballing art
tests/world.html    generates an island and shows it whole and at 1:1
```

## Tests

Open `tests/sim.html` in a browser — it runs 86 assertions against the
simulation (combat resolves, waves advance and escalate, downing, revival and
bleedout, six-player seating, world collision, shoreline sliding, prop spacing
and solidity, seed determinism, pickups and every weapon's behaviour, kill
credit, scoreboard ordering and tie-breaking, and snapshot encode/decode
round-tripping) and prints pass/fail. Every case runs on a fixed seed so the
suite is deterministic.

`tests/sprites.html` renders every frame of every mail colour and enemy.
`tests/world.html` generates an island and shows it both whole and at 1:1;
pass `?seed=N` to try a different one.
