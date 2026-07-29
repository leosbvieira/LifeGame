/* =========================================================================
   THE LONG QUIET — galaxy.js
   The whole galaxy is derived from one seed: a barred spiral of star systems,
   each with its own worlds, wrecks and silence. Nothing is stored on disk.
   ========================================================================= */
(function (global) {
  'use strict';

  const STAR_CLASSES = [
    // name, colorA (core), colorB (rim), radius scale, weight
    { cls: 'M', label: 'red dwarf',     a: [1.00, 0.42, 0.22], b: [1.00, 0.66, 0.35], r: 0.62, w: 34 },
    { cls: 'K', label: 'orange dwarf',  a: [1.00, 0.62, 0.30], b: [1.00, 0.82, 0.52], r: 0.80, w: 20 },
    { cls: 'G', label: 'yellow star',   a: [1.00, 0.86, 0.58], b: [1.00, 0.96, 0.82], r: 1.00, w: 16 },
    { cls: 'F', label: 'white star',    a: [0.94, 0.94, 0.92], b: [1.00, 1.00, 1.00], r: 1.15, w: 10 },
    { cls: 'A', label: 'blue-white',    a: [0.72, 0.82, 1.00], b: [0.90, 0.95, 1.00], r: 1.35, w: 8 },
    { cls: 'B', label: 'blue giant',    a: [0.55, 0.70, 1.00], b: [0.80, 0.90, 1.00], r: 1.90, w: 5 },
    { cls: 'N', label: 'neutron star',  a: [0.80, 0.92, 1.00], b: [1.00, 1.00, 1.00], r: 0.22, w: 4 },
    { cls: 'D', label: 'dying ember',   a: [0.70, 0.16, 0.10], b: [0.95, 0.36, 0.18], r: 1.55, w: 3 }
  ];

  const PLANET_KINDS = [
    'rocky', 'ocean', 'desert', 'ice', 'gas', 'lava', 'toxic', 'verdant', 'barren', 'shattered'
  ];

  // Biome palettes: [sea/base, low, high, peak] + atmosphere tint.
  const PALETTES = {
    rocky:     { p: [[0.16,0.18,0.22],[0.35,0.31,0.27],[0.52,0.47,0.42],[0.72,0.70,0.68]], atmo: [0.35,0.42,0.55], water: 0.34, ice: 0.80, clouds: 0.18 },
    ocean:     { p: [[0.03,0.19,0.38],[0.22,0.42,0.28],[0.42,0.50,0.30],[0.75,0.76,0.72]], atmo: [0.35,0.58,0.95], water: 0.62, ice: 0.72, clouds: 0.48 },
    desert:    { p: [[0.42,0.30,0.16],[0.70,0.52,0.28],[0.84,0.68,0.42],[0.94,0.86,0.70]], atmo: [0.85,0.60,0.35], water: 0.10, ice: 0.90, clouds: 0.10 },
    ice:       { p: [[0.30,0.44,0.58],[0.62,0.74,0.84],[0.82,0.90,0.96],[0.96,0.98,1.00]], atmo: [0.62,0.80,1.00], water: 0.45, ice: 0.24, clouds: 0.35 },
    gas:       { p: [[0.52,0.36,0.24],[0.78,0.62,0.42],[0.92,0.84,0.68],[0.86,0.42,0.30]], atmo: [0.80,0.66,0.48], water: 0.0,  ice: 1.0,  clouds: 0.0 },
    lava:      { p: [[0.18,0.06,0.05],[0.34,0.14,0.10],[0.48,0.22,0.14],[0.66,0.34,0.18]], atmo: [1.00,0.42,0.18], water: 0.30, ice: 1.00, clouds: 0.22 },
    toxic:     { p: [[0.20,0.26,0.10],[0.42,0.48,0.16],[0.62,0.66,0.24],[0.78,0.80,0.46]], atmo: [0.72,0.90,0.30], water: 0.40, ice: 0.94, clouds: 0.62 },
    verdant:   { p: [[0.04,0.22,0.34],[0.16,0.40,0.20],[0.36,0.52,0.24],[0.68,0.66,0.58]], atmo: [0.42,0.70,0.95], water: 0.55, ice: 0.76, clouds: 0.44 },
    barren:    { p: [[0.14,0.13,0.13],[0.28,0.26,0.25],[0.44,0.42,0.40],[0.60,0.58,0.56]], atmo: [0.30,0.30,0.34], water: 0.0,  ice: 0.95, clouds: 0.0 },
    shattered: { p: [[0.10,0.09,0.12],[0.26,0.20,0.28],[0.44,0.30,0.40],[0.72,0.52,0.62]], atmo: [0.55,0.35,0.65], water: 0.0,  ice: 0.98, clouds: 0.05 }
  };

  const PLANET_DESC = {
    rocky: ['Bare stone, cratered and patient.', 'Tectonics long since stopped. Nothing moves but dust.', 'Iron-heavy crust. Compass useless here.'],
    ocean: ['Water world. No landmass above four metres.', 'One ocean, no shore, weather that never repeats.', 'Something down there makes the tides run late.'],
    desert: ['Silicate dunes at 400 kelvin. Wind never stops.', 'Salt flats where a sea used to be.', 'Dry. Very dry. The rock remembers rain.'],
    ice: ['Nitrogen frost over a possible subsurface ocean.', 'Cryovolcanic plumes on the terminator.', 'Cold enough that the air here would fall as snow.'],
    gas: ['No surface. Descent is a one-way measurement.', 'Storm bands wider than most homeworlds.', 'Ammonia clouds. Lightning the size of continents.'],
    lava: ['Crust in pieces, mantle showing through.', 'Tidally tortured. It will not survive its own orbit.', 'Surface temperature exceeds hull rating.'],
    toxic: ['Runaway atmosphere. Chlorine and worse.', 'Pressure would fold the ship in eleven seconds.', 'Green sky. Nothing beneath it agrees to live.'],
    verdant: ['Biosignature confirmed. Chlorophyll analogue.', 'It is alive. It has never been asked its name.', 'Forests to the poles. No cities. No lights.'],
    barren: ['Airless. Sterile. Perfectly quiet.', 'A moon that outlived its planet.', 'Regolith three metres deep. Footprints would last forever.'],
    shattered: ['Broken world. The pieces still orbit each other.', 'Something took this apart a long time ago.', 'Fractured mantle, exposed core, no explanation.']
  };

  const GALAXY_SEED = 'the-long-quiet-01';
  const ARMS = 4;
  const RADIUS = 2200;          // galactic radius in map units
  const SYSTEM_COUNT = 240;

  function pickWeighted(rng, list) {
    let total = 0;
    for (const it of list) total += it.w;
    let r = rng.next() * total;
    for (const it of list) { r -= it.w; if (r <= 0) return it; }
    return list[list.length - 1];
  }

  // --- System generation ----------------------------------------------------
  function makeSystem(index, rng) {
    // Place along a logarithmic spiral arm with scatter.
    const arm = index % ARMS;
    const t = Math.pow(rng.range(0.06, 1.0), 0.72);
    const radius = t * RADIUS;
    const spin = t * 3.1;
    const ang = (arm / ARMS) * Math.PI * 2 + spin + rng.gauss() * 0.20;
    const scatter = (1 - t) * 60 + 90;
    const pos = {
      x: Math.cos(ang) * radius + rng.gauss() * scatter,
      y: rng.gauss() * (28 + 90 * (1 - t)),
      z: Math.sin(ang) * radius + rng.gauss() * scatter
    };

    const star = pickWeighted(rng, STAR_CLASSES);
    const name = U.systemName(rng);
    const sys = {
      id: index,
      name: name,
      pos: pos,
      star: star,
      seed: U.hashStr(name + '::' + index),
      distanceFromCore: Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z),
      visited: false,
      isCore: false
    };

    // Contents.
    const srng = U.Rng(sys.seed);
    const count = star.cls === 'N' || star.cls === 'D' ? srng.int(0, 3) : srng.int(1, 6);
    sys.planets = [];
    let orbit = srng.range(1400, 2400);
    for (let i = 0; i < count; i++) {
      const kind = choosePlanetKind(srng, orbit, star);
      const radiusP = kind === 'gas'
        ? srng.range(260, 520)
        : srng.range(70, 190);
      sys.planets.push({
        idx: i,
        kind: kind,
        name: sys.name + ' ' + U.romanize(i + 1),
        radius: radiusP,
        orbit: orbit,
        // Slow enough that a world does not outrun you mid-scan, fast enough
        // that a system is visibly in motion if you sit and watch it.
        orbitSpeed: (srng.range(0.6, 1.4) * 0.004) / Math.pow(orbit / 2000, 1.5),
        phase: srng.range(0, Math.PI * 2),
        tilt: srng.gauss() * 0.35,
        inclination: srng.gauss() * 0.09,
        seed: srng.range(0, 100),
        rings: kind === 'gas' ? srng.chance(0.55) : srng.chance(0.08),
        moons: srng.int(0, kind === 'gas' ? 3 : 1),
        city: (kind === 'verdant' || kind === 'ocean' || kind === 'desert') && srng.chance(0.18),
        scanned: false,
        desc: null
      });
      orbit *= srng.range(1.42, 1.95);
    }

    // A belt sits in a gap, not on top of a world: find the widest ratio
    // between adjacent orbits and drop it in there, or park it outside.
    sys.hasBelt = srng.chance(0.42) && sys.planets.length > 1;
    if (sys.hasBelt) {
      let bestGap = 0, bestR = 0;
      for (let i = 0; i < sys.planets.length - 1; i++) {
        const a = sys.planets[i].orbit, b = sys.planets[i + 1].orbit;
        if (b / a > bestGap) { bestGap = b / a; bestR = Math.sqrt(a * b); }
      }
      const last = sys.planets[sys.planets.length - 1].orbit;
      sys.beltRadius = bestGap > 1.7 ? bestR : last * srng.range(1.3, 1.6);
    } else {
      sys.beltRadius = 0;
    }
    sys.hasNebula = srng.chance(0.26);
    sys.nebulaHue = srng.range(0, 1);
    sys.derelict = srng.chance(0.30);
    sys.anomaly = srng.chance(0.10);
    return sys;
  }

  function choosePlanetKind(rng, orbit, star) {
    const heat = (star.r * star.r * 4200) / (orbit * 0.0016);
    const roll = rng.next();
    if (orbit > 9000) return roll < 0.55 ? 'ice' : (roll < 0.8 ? 'gas' : 'barren');
    if (heat > 900) return roll < 0.5 ? 'lava' : (roll < 0.8 ? 'desert' : 'barren');
    if (heat > 380) return roll < 0.3 ? 'desert' : (roll < 0.5 ? 'rocky' : (roll < 0.65 ? 'toxic' : 'barren'));
    if (heat > 120) {
      if (roll < 0.18) return 'verdant';
      if (roll < 0.34) return 'ocean';
      if (roll < 0.55) return 'rocky';
      if (roll < 0.7) return 'desert';
      return rng.chance(0.4) ? 'toxic' : 'barren';
    }
    if (roll < 0.35) return 'gas';
    if (roll < 0.6) return 'ice';
    if (roll < 0.8) return 'rocky';
    return rng.chance(0.3) ? 'shattered' : 'barren';
  }

  // --- Build --------------------------------------------------------------
  function build() {
    const rng = U.Rng(GALAXY_SEED);
    const systems = [];
    for (let i = 0; i < SYSTEM_COUNT; i++) systems.push(makeSystem(i, rng));

    // Nothing lives close to the core; clear a cavity for the black hole.
    const filtered = systems.filter(s => s.distanceFromCore > 260);
    filtered.forEach((s, i) => { s.id = i; });

    // The Core: Sagittarius-like supermassive black hole at the galactic centre.
    const core = {
      id: filtered.length,
      name: 'THE CORE',
      pos: { x: 0, y: 0, z: 0 },
      star: { cls: 'X', label: 'supermassive black hole', a: [0, 0, 0], b: [1, 0.6, 0.25], r: 0, w: 0 },
      seed: U.hashStr('core'),
      distanceFromCore: 0,
      planets: [],
      hasBelt: false,
      hasNebula: true,
      nebulaHue: 0.55,
      derelict: true,
      anomaly: true,
      visited: false,
      isCore: true
    };
    filtered.push(core);

    // Starting system: something quiet, far out, with a world worth naming.
    let start = filtered.find(s => !s.isCore && s.distanceFromCore > RADIUS * 0.72 &&
      s.planets.some(p => p.kind === 'verdant' || p.kind === 'ocean'));
    if (!start) start = filtered.find(s => !s.isCore && s.planets.length > 2) || filtered[0];

    return { systems: filtered, start: start, radius: RADIUS, core: core };
  }

  // Nearest systems within jump range, sorted by distance.
  function neighbours(galaxy, from, range, limit) {
    const out = [];
    for (const s of galaxy.systems) {
      if (s === from) continue;
      const dx = s.pos.x - from.pos.x, dy = s.pos.y - from.pos.y, dz = s.pos.z - from.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= range) out.push({ sys: s, dist: d });
    }
    out.sort((a, b) => a.dist - b.dist);
    return limit ? out.slice(0, limit) : out;
  }

  function describePlanet(planet, rng) {
    const lines = PLANET_DESC[planet.kind] || PLANET_DESC.barren;
    return lines[Math.floor(rng.next() * lines.length) % lines.length];
  }

  global.GALAXY = {
    build, neighbours, describePlanet, PLANET_KINDS, PALETTES, STAR_CLASSES,
    RADIUS, GALAXY_SEED
  };
})(window);
