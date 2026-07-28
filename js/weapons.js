// Weapon upgrades.
//
// Everyone always keeps their sword. A pickup layers something on top of it
// for a short while rather than swapping your attack out — being handed a
// weapon you turn out to be worse with is not a reward, and nobody wants to
// discover mid-wave that the shiny thing they ran across the island for made
// them weaker.
//
// Each weapon hooks the same moment: the instant a swing starts. `melee`
// adjusts the sword itself, `fire` may launch projectiles, and the simulation
// owns everything after that.

export const WEAPON_NAMES = ['master', 'bow', 'rang', 'rod'];

export const WEAPON_TYPES = {
  master: {
    label: 'Master Sword',
    tag: 'MASTER',
    color: '#8fe3ff',
    duration: 22,
    melee: { dmg: 1, range: 8, arc: 0 },
    fire(p, ctx) {
      // A Link to the Past only fires the beam at full health. Here it is
      // every swing: the pickup is already the rare part, and a power-up that
      // switches itself off the moment you get hit reads as broken.
      ctx.shot(p, { kind: 'beam', speed: 220, dmg: 2, life: 0.7, radius: 5, pierce: true });
    },
  },

  bow: {
    label: 'Bow',
    tag: 'BOW',
    color: '#c8a24a',
    duration: 22,
    // Reach. Single target, but it kills an Octorok before it can spit.
    fire(p, ctx) {
      ctx.shot(p, { kind: 'arrow', speed: 300, dmg: 3, life: 1.1, radius: 4 });
    },
  },

  rang: {
    label: 'Boomerang',
    tag: 'RANG',
    color: '#7dfc9a',
    duration: 22,
    // Crowd control: light damage, but it sweeps a line twice and shoves
    // everything it touches. One in the air at a time, like the real one.
    fire(p, ctx) {
      if (ctx.has(p, 'rang')) return;
      ctx.shot(p, { kind: 'rang', speed: 160, dmg: 1, life: 2.4, radius: 6, knock: 2.6 });
    },
  },

  rod: {
    label: 'Fire Rod',
    tag: 'ROD',
    color: '#ff7a2a',
    duration: 22,
    // Slow, but it does not care how many of them are standing together.
    fire(p, ctx) {
      ctx.shot(p, { kind: 'fire', speed: 150, dmg: 3, life: 1.3, radius: 5, splash: 28 });
    },
  },
};

/** Pick a weapon to drop. Uniform — none of them is a consolation prize. */
export function randomWeapon(rand = Math.random) {
  return WEAPON_NAMES[(rand() * WEAPON_NAMES.length) | 0];
}

/** Sword stats after whatever the player is currently holding. */
export function meleeStats(weapon, baseRange, baseArc) {
  const m = (weapon && WEAPON_TYPES[weapon] && WEAPON_TYPES[weapon].melee) || null;
  return {
    dmg: m ? m.dmg : 0,
    range: baseRange + (m ? m.range : 0),
    arc: baseArc + (m ? m.arc : 0),
  };
}
