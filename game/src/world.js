// The game's rules and state, with no drawing and no browser in it: the plane, the
// islands and strips, the rings, the three missions, fuel and damage, landings and
// crashes. step() advances one fixed step and returns what happened as bit flags, so
// the caller can react without the world knowing about screens or sound. Nothing here
// allocates after createWorld returns.
import { ISLANDS, LANDING, MISSIONS, PLANE, RINGS, SCORE, STEP, STRIPS } from './config.js';
import { createRandom, hashNoise } from './random.js';

export const EVENT_RING = 1;
export const EVENT_TOUCHDOWN = 2;
export const EVENT_LAND = 4;
export const EVENT_CRASH = 8;
export const EVENT_DELIVER = 16;
export const EVENT_COMPLETE = 32;
export const EVENT_FUEL = 64;
export const EVENT_HARD = 128;

const GRAVITY = 9.81;
const KNOTS = 1.94384;
const FEET = 3.28084;

/** Smoothstep falloff of an island bump, 1 at the centre, 0 at the rim. */
function bump(distance, radius) {
  const u = 1 - distance / radius;
  if (u <= 0) return 0;
  return u * u * (3 - 2 * u);
}

/** Smooth 0..1 noise over the land, from a lattice 400 m across. */
function smoothNoise(x, z) {
  const size = 400;
  const ix = Math.floor(x / size);
  const iz = Math.floor(z / size);
  const fx = x / size - ix;
  const fz = z / size - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hashNoise(ix, iz);
  const b = hashNoise(ix + 1, iz);
  const c = hashNoise(ix, iz + 1);
  const d = hashNoise(ix + 1, iz + 1);
  return a + (b - a) * ux + (c + (d - c) * ux - (a + (b - a) * ux)) * uz;
}

/** The ground height at a world point, in metres above the sea. */
export function heightAt(x, z) {
  let height = 0;
  for (let index = 0; index < ISLANDS.length; index += 1) {
    const island = ISLANDS[index];
    const dx = x - island.x;
    const dz = z - island.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    height += island.peak * bump(distance, island.radius);
    if (island.volcano) {
      const vx = x - island.volcano.x;
      const vz = z - island.volcano.z;
      height += island.volcano.peak * bump(Math.sqrt(vx * vx + vz * vz), island.volcano.radius);
    }
  }
  if (height > 2) height += (smoothNoise(x, z) - 0.5) * 22;
  // Airstrips are flat aprons: blend the terrain down to sea level across a 300 m margin.
  for (let index = 0; index < STRIPS.length; index += 1) {
    const strip = STRIPS[index];
    // Along the strip is the runway's own direction (sin h, -cos h); across is its perpendicular.
    const along = (x - strip.x) * Math.sin(strip.heading) - (z - strip.z) * Math.cos(strip.heading);
    const across = (x - strip.x) * Math.cos(strip.heading) + (z - strip.z) * Math.sin(strip.heading);
    const over = Math.max(Math.abs(along) - strip.halfLength, Math.abs(across) - strip.halfWidth);
    if (over < 300) {
      // Inside the rectangle the ground is flat; it blends back to full height
      // over a 300 m margin, so the strip sits in a gentle hollow, not on a cliff.
      const blend = Math.max(0, Math.min(1, over / 300));
      height *= blend;
    }
  }
  return Math.max(0, height);
}

/** The strip whose rectangle holds (x, z), or null. A small margin counts as the strip. */
function stripAt(x, z) {
  for (let index = 0; index < STRIPS.length; index += 1) {
    const strip = STRIPS[index];
    const along = (x - strip.x) * Math.sin(strip.heading) - (z - strip.z) * Math.cos(strip.heading);
    const across = (x - strip.x) * Math.cos(strip.heading) + (z - strip.z) * Math.sin(strip.heading);
    if (Math.abs(along) <= strip.halfLength + 40 && Math.abs(across) <= strip.halfWidth + 40) return strip;
  }
  return null;
}

export function createWorld(seed = 7) {
  const random = createRandom(seed);
  const home = STRIPS[0];
  const plane = {
    x: 0, z: 0, alt: 0, heading: 0, pitch: 0, roll: 0,
    speed: 0, vs: 0, throttle: 0, flaps: false,
    fuel: PLANE.fuel, damage: 0, onGround: true, airborneOnce: false,
  };
  const mission = { id: 'cincin', name: '', goal: '', ringIndex: 0, deliveries: 0, target: 0, done: false };
  const rings = RINGS.map((ring) => ({ ...ring, passed: false }));
  const clouds = [];
  for (let index = 0; index < 14; index += 1) {
    clouds.push({
      x: (random() * 2 - 1) * 11500,
      z: (random() * 2 - 1) * 11500,
      alt: 650 + random() * 450,
      size: 320 + random() * 420,
    });
  }
  const state = {
    plane, mission, rings, clouds,
    score: 0, time: 0, status: 'flying', fuelWarned: false,
    message: '', messageUntil: 0,
  };

  function say(text, seconds) {
    state.message = text;
    state.messageUntil = state.time + seconds;
  }

  /** The delivery route for the mail mission: Kelapa, Cendana, then home. */
  function mailRoute() {
    return [STRIPS[1], STRIPS[2], STRIPS[0]];
  }

  /** Where the pilot should aim next: a ring, or the strip to land on. */
  function nextTarget() {
    if (mission.id === 'cincin') {
      if (mission.ringIndex >= rings.length) return null;
      const ring = rings[mission.ringIndex];
      return { kind: 'ring', name: `Cincin ${mission.ringIndex + 1}/5`, x: ring.x, z: ring.z, alt: ring.alt };
    }
    if (mission.id === 'pos') {
      const route = mailRoute();
      if (mission.deliveries >= route.length) return null;
      const strip = route[mission.deliveries];
      return { kind: 'strip', name: `Antar ke ${strip.name}`, x: strip.x, z: strip.z, alt: 0, heading: strip.heading };
    }
    return { kind: 'strip', name: 'Mendarat di Merpati', x: home.x, z: home.z, alt: 0, heading: home.heading };
  }

  function reset(missionId) {
    const found = MISSIONS.find((entry) => entry.id === missionId) || MISSIONS[0];
    mission.id = found.id;
    mission.name = found.name;
    mission.goal = found.goal;
    mission.ringIndex = 0;
    mission.deliveries = 0;
    mission.target = 0;
    mission.done = false;
    for (const ring of rings) {
      ring.passed = false;
      ring.alt = Math.max(150, heightAt(ring.x, ring.z) + 150);
    }
    // On the home runway's west threshold, facing east down the strip, ready to roll.
    plane.x = home.x - home.halfLength + 120;
    plane.z = home.z;
    plane.alt = 0;
    plane.heading = Math.PI / 2;
    plane.pitch = 0;
    plane.roll = 0;
    plane.speed = 0;
    plane.vs = 0;
    plane.throttle = 0;
    plane.flaps = false;
    plane.fuel = PLANE.fuel;
    plane.damage = 0;
    plane.onGround = true;
    plane.airborneOnce = false;
    state.score = 0;
    state.time = 0;
    state.status = 'flying';
    state.fuelWarned = false;
    say(`${found.name} — ${found.goal}`, 6);
  }

  function crash(reason) {
    state.status = 'crashed';
    say(reason, 999);
    return EVENT_CRASH;
  }

  function complete(text) {
    mission.done = true;
    state.status = 'complete';
    say(text, 999);
    return EVENT_COMPLETE;
  }

  function landOn(strip) {
    const soft = plane.vs >= -2 && Math.abs(plane.roll) < 0.15;
    let events = EVENT_TOUCHDOWN;
    plane.onGround = true;
    plane.alt = 0;
    plane.vs = 0;
    if (plane.damage > 0) state.score = Math.max(0, state.score - SCORE.hardLandingPenalty);
    if (mission.id === 'pos') {
      const route = mailRoute();
      const expected = route[mission.deliveries];
      if (expected && strip.name === expected.name) {
        mission.deliveries += 1;
        state.score += SCORE.delivery;
        events |= EVENT_DELIVER;
        say(`SURAT TERKIRIM di ${strip.name}! (${mission.deliveries}/3)`, 4);
        if (mission.deliveries >= route.length) {
          state.score += SCORE.landing;
          events |= complete(`MISI SELESAI! Semua surat terkirim. Skor ${state.score}.`);
          return events;
        }
        plane.fuel = Math.min(PLANE.fuel, plane.fuel + 25);
        say(`SURAT TERKIRIM di ${strip.name}! (${mission.deliveries}/3) — isi bahan bakar sedikit, lanjut!`, 4);
        return events;
      }
      say(`Mendarat di ${strip.name} — bukan tujuan. Lanjutkan ke ${expected ? expected.name : 'Merpati'}.`, 4);
      return events;
    }
    if (mission.id === 'mendarat') {
      if (!plane.airborneOnce) {
        say('Lepas landas dulu, lalu mendarat kembali di sini.', 4);
        return events;
      }
      if (strip.name === 'Merpati') {
        state.score += SCORE.landing + (soft ? 50 : 0);
        events |= EVENT_LAND;
        events |= complete(`MENDARAT! Skor ${state.score}${soft ? ' — pendaratan halus!' : ''}`);
        return events;
      }
    }
    say(`Mendarat di ${strip.name}.`, 4);
    return events;
  }

  /**
   * One fixed step. `ctrl` is { pitch, roll, throttle, rudder, flaps, brake }, each
   * -1..1 except throttle 0..1 and the two booleans. Returns EVENT_* bit flags.
   */
  function step(dt, ctrl) {
    let events = 0;
    if (state.status === 'crashed' || state.status === 'complete') return events;
    state.time += dt;

    // Throttle chases the stick; an empty tank forces a glide.
    const wanted = state.fuel <= 0 ? 0 : ctrl.throttle;
    plane.throttle += Math.max(-1.2 * dt, Math.min(1.2 * dt, wanted - plane.throttle));
    if (state.fuel > 0 && plane.throttle > 0.02) {
      state.fuel -= PLANE.fuelBurn * (0.25 + 0.75 * plane.throttle) * dt;
      if (state.fuel <= 0) {
        state.fuel = 0;
        events |= EVENT_FUEL;
        say('BAHAN BAKAR HABIS! Meluncur — cari landasan!', 5);
      } else if (state.fuel < 20 && !state.fuelWarned) {
        state.fuelWarned = true;
        say('Bahan bakar menipis!', 4);
      }
    }
    plane.flaps = ctrl.flaps;
    const stall = plane.flaps ? PLANE.stallSpeedFlaps : PLANE.stallSpeed;
    const topSpeed = plane.flaps ? PLANE.maxSpeedFlaps : PLANE.maxSpeed;

    if (plane.onGround) {
      // Rolling: throttle pushes, brakes and drag slow, the stick steers gently.
      const ground = heightAt(plane.x, plane.z);
      plane.alt = ground;
      plane.speed += plane.throttle * 16 * dt;
      plane.speed -= (ctrl.brake ? 9 : 1.2) * dt;
      plane.speed = Math.max(0, plane.speed);
      plane.heading += ctrl.roll * 0.14 * dt * Math.min(1, plane.speed / 25);
      plane.heading += ctrl.rudder * 0.05 * dt * Math.min(1, plane.speed / 25);
      if (plane.speed > stall && ctrl.pitch > 0.05) {
        plane.onGround = false;
        plane.airborneOnce = true;
        plane.alt = ground + 0.5;
        plane.vs = 3;
        plane.pitch = 0.12;
        say('Lepas landas!', 3);
      }
      return events;
    }

    // Airborne: pitch and roll chase the stick, then settle toward level.
    const pitchTarget = ctrl.pitch * PLANE.maxPitch;
    plane.pitch += Math.max(-PLANE.pitchRate * dt, Math.min(PLANE.pitchRate * dt, pitchTarget - plane.pitch));
    if (ctrl.pitch === 0) plane.pitch += Math.max(-PLANE.pitchSettle * dt, Math.min(PLANE.pitchSettle * dt, -plane.pitch));
    const rollTarget = ctrl.roll * PLANE.maxRoll;
    plane.roll += Math.max(-PLANE.rollRate * dt, Math.min(PLANE.rollRate * dt, rollTarget - plane.roll));
    if (ctrl.roll === 0) plane.roll += Math.max(-PLANE.rollSettle * dt, Math.min(PLANE.rollSettle * dt, -plane.roll));

    // Speed chases the throttle's target; a stalled wing sinks.
    const targetSpeed = plane.throttle * topSpeed;
    plane.speed += (targetSpeed - plane.speed) * Math.min(1, PLANE.speedRate * dt);
    const sink = plane.speed < stall ? (stall - plane.speed) * 0.45 : 0;
    plane.vs = Math.sin(plane.pitch) * plane.speed * 0.92 - sink;

    // A banked turn: heading rate follows the bank and the speed.
    plane.heading += (GRAVITY * Math.tan(plane.roll) / Math.max(plane.speed, 20)) * dt;
    plane.heading += ctrl.rudder * PLANE.rudderRate * dt;

    const forwardX = Math.sin(plane.heading);
    const forwardZ = -Math.cos(plane.heading);
    plane.x += forwardX * plane.speed * Math.cos(plane.pitch) * dt;
    plane.z += forwardZ * plane.speed * Math.cos(plane.pitch) * dt;
    plane.alt += plane.vs * dt;

    // Rings: flying through the next one scores and moves the course on.
    if (mission.id === 'cincin' && mission.ringIndex < rings.length) {
      const ring = rings[mission.ringIndex];
      const dx = plane.x - ring.x;
      const dy = plane.alt - ring.alt;
      const dz = plane.z - ring.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < ring.radius * 0.9) {
        ring.passed = true;
        mission.ringIndex += 1;
        state.score += SCORE.ring;
        events |= EVENT_RING;
        if (mission.ringIndex >= rings.length) {
          const par = 420;
          const bonus = Math.max(0, Math.round((par - state.time) * SCORE.timeBonusPerSecond));
          state.score += bonus;
          events |= complete(`SEMUA CINCIN! Skor ${state.score} (bonus waktu ${bonus}).`);
        } else {
          say(`Cincin ${mission.ringIndex}/5!`, 3);
        }
      }
    }

    // The ground: a good touchdown on a strip, or a crash anywhere else.
    const ground = heightAt(plane.x, plane.z);
    if (plane.alt <= ground) {
      const strip = stripAt(plane.x, plane.z);
      const goodSpeed = plane.speed >= LANDING.minSpeed && plane.speed <= LANDING.maxSpeed;
      const goodSink = plane.vs >= LANDING.maxSink;
      const goodRoll = Math.abs(plane.roll) <= LANDING.maxRoll;
      if (strip && goodSink && goodRoll && goodSpeed) {
        events |= landOn(strip);
      } else if (strip && goodSink && goodRoll && plane.speed > LANDING.maxSpeed) {
        plane.damage += 15;
        plane.alt = 0;
        plane.vs = 0;
        plane.onGround = true;
        plane.speed *= 0.6;
        events |= EVENT_HARD;
        say('Mendarat terlalu cepat! Rem!', 4);
      } else if (strip && plane.speed < LANDING.minSpeed && plane.vs >= LANDING.maxSink) {
        plane.damage += 20;
        plane.alt = 1.5;
        plane.vs = 2;
        events |= EVENT_HARD;
        say('Stall di atas landasan!', 4);
      } else if (strip) {
        plane.damage += PLANE.hardLandingDamage;
        plane.alt = 1;
        plane.vs = 2.2;
        events |= EVENT_HARD;
        say('MENDARAT KERAS!', 3);
        if (plane.damage >= 100) events |= crash('Pesawat rusak berat. JATUH!');
      } else if (ground <= 0.5) {
        events |= crash('JATUH DI LAUT!');
      } else if (ground <= 3 && goodSink && goodRoll && goodSpeed) {
        // Flat grass or beach beside a strip: a rough landing, not a crash. The
        // plane rolls on the grass and can take off again for another try.
        plane.damage += PLANE.hardLandingDamage;
        plane.onGround = true;
        plane.alt = ground;
        plane.vs = 0;
        plane.speed *= 0.7;
        events |= EVENT_HARD;
        say('Mendarat di luar landasan!', 3);
        if (plane.damage >= 100) events |= crash('Pesawat rusak berat. JATUH!');
      } else {
        events |= crash('MENABRAK BUKIT!');
      }
    }

    // Out of the world: turn back with a warning rather than flying forever.
    if (Math.abs(plane.x) > 12500 || Math.abs(plane.z) > 12500) {
      plane.heading += Math.PI;
      plane.x = Math.max(-12500, Math.min(12500, plane.x));
      plane.z = Math.max(-12500, Math.min(12500, plane.z));
      say('Balik — kamu keluar dari peta!', 4);
    }
    return events;
  }

  reset('cincin');
  return {
    state, reset, step, heightAt, stripAt, nextTarget, random,
    knots: (speed) => Math.round(speed * KNOTS),
    feet: (alt) => Math.round(alt * FEET),
  };
}
