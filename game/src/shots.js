// The screenshot scenes behind ?shot=cover|ring|land|done. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by a simple autopilot
// (aim at the next ring or strip, climb over the terrain ahead, line up with the runway
// and glide onto it), so the frame is what a real flight looks like and the same seed
// always gives the same frame.
import { STEP } from './config.js';
import { EVENT_COMPLETE, EVENT_CRASH, EVENT_RING, EVENT_TOUCHDOWN } from './world.js';
import { SCREEN_DONE, SCREEN_OVER, SCREEN_PLAY } from './render.js';

/** The highest ground in front of the plane, out to `limit` metres. A landing approach
 *  only looks as far as the strip: the mountain beyond the runway is not in the way. */
function terrainAhead(world, limit) {
  const plane = world.state.plane;
  let highest = 0;
  for (const distance of [400, 900, 1600, 2600]) {
    if (distance > limit) continue;
    const x = plane.x + Math.sin(plane.heading) * distance;
    const z = plane.z - Math.cos(plane.heading) * distance;
    highest = Math.max(highest, world.heightAt(x, z));
  }
  return highest;
}

function wrapAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * The autopilot's controls for this step: bank toward the aim point, pitch toward the
 * altitude the phase needs, throttle for the phase, flaps on final, and a climb over
 * any ground ahead. On the ground it rolls and rotates for takeoff. A strip is
 * approached along its own axis: far out the aim point is 900 m before the centre on
 * the side the plane is coming from, so the plane lines up with the runway.
 *
 * A landing mission starts with a departure: after takeoff the plane flies straight
 * ahead and climbs to 250 m before it turns back for the strip, so it flies a circuit
 * instead of wallowing over the runway at 20 m/s. A plane that starts already high
 * (a staged shot on final) skips the departure.
 */
const phases = new WeakMap();

export function autopilot(world) {
  const plane = world.state.plane;
  const target = world.nextTarget();
  const ctrl = { pitch: 0, roll: 0, throttle: 0.6, rudder: 0, flaps: false, brake: false };
  if (!target) return ctrl;
  let phase = phases.get(world);
  if (!phase) {
    phase = { seen: true, departed: plane.alt > 50 };
    phases.set(world, phase);
  }
  if (plane.onGround) {
    phase.departed = false;
    phase.landDir = null;
  }
  const dx = target.x - plane.x;
  const dz = target.z - plane.z;
  const distance = Math.hypot(dx, dz);
  // The departure ends once the plane is both high and well clear of the strip:
  // ending it on altitude alone turns the plane back right over the runway.
  if (plane.alt > 200 && distance > 2500) phase.departed = true;
  if (plane.onGround) {
    ctrl.throttle = 1;
    ctrl.pitch = plane.speed > 34 ? 0.7 : 0;
    return ctrl;
  }
  if (target.kind === 'strip' && !phase.departed) {
    // Departure: fly straight ahead, climbing to 250 m, flaps up.
    const aimX = plane.x + Math.sin(plane.heading) * 3000;
    const aimZ = plane.z - Math.cos(plane.heading) * 3000;
    const desiredHeading = Math.atan2(aimX - plane.x, -(aimZ - plane.z));
    ctrl.roll = Math.max(-1, Math.min(1, wrapAngle(desiredHeading - plane.heading) * 1.6));
    const targetAlt = Math.max(250, terrainAhead(world, 2600) + 120);
    ctrl.pitch = Math.max(-0.9, Math.min(0.9, (targetAlt - plane.alt) * 0.015 + 0.05));
    ctrl.throttle = 0.7;
    return ctrl;
  }
  let aimX = target.x;
  let aimZ = target.z;
  let targetAlt = target.alt;
  let pitchFeed = 0;
  let flare = false;
  if (target.kind === 'ring') {
    targetAlt = Math.max(target.alt, terrainAhead(world, 2600) + 120, world.heightAt(plane.x, plane.z) + 80);
    ctrl.throttle = distance < 400 ? 0.5 : 0.65;
    pitchFeed = 0.05;
  } else {
    // The landing direction is latched when the plane commits to the approach:
    // recomputing it every step flips the far end of the runway each time the plane
    // crosses the centre, and the plane ends up orbiting the strip.
    if (phase.landTarget !== target.name || !phase.landDir || distance > 3000) {
      phase.landTarget = target.name;
      const dirX = Math.sin(target.heading);
      const dirZ = -Math.cos(target.heading);
      const sign = dx * dirX + dz * dirZ >= 0 ? 1 : -1;
      phase.landDir = { x: dirX * sign, z: dirZ * sign };
    }
    const landDirX = phase.landDir.x;
    const landDirZ = phase.landDir.z;
    // The touchdown point: 200 m past the near threshold, down the runway.
    const tdX = target.x - landDirX * 200;
    const tdZ = target.z - landDirZ * 200;
    const distTd = Math.hypot(tdX - plane.x, tdZ - plane.z);
    // Carrot guidance: chase a point on the runway centreline 800 m ahead of the
    // plane's along-track position, shifted to the opposite side by half the
    // cross-track error. The point moves with the plane, so it can never be reached
    // and orbited, and the correction is strong from far out — aiming at a fixed
    // distant point corrects a 200 m offset far too gently to line up in time.
    const perpX = -landDirZ;
    const perpZ = landDirX;
    const along = (plane.x - target.x) * landDirX + (plane.z - target.z) * landDirZ;
    const across = (plane.x - target.x) * perpX + (plane.z - target.z) * perpZ;
    aimX = target.x + landDirX * (along + 800) - perpX * across * 0.5;
    aimZ = target.z + landDirZ * (along + 800) - perpZ * across * 0.5;
    // One smooth slope down to the touchdown point, 0.08 (about 4.6 degrees), so
    // the plane is low and slow on final instead of arriving high and fast. The
    // terrain that matters is the ground between the plane and that point, not the
    // hill past the runway — and only if there is ground ahead at all: over the sea
    // the clearance is zero, or the plane would never come down below 60 m. Far out,
    // the plane looks 2.6 km ahead and climbs over whatever is there with no cap:
    // the direct route home crosses Merpati's 880 m peak, and a capped clearance
    // would fly it straight into the mountain.
    const glideAlt = Math.max(0, distTd * 0.08);
    const look = distTd > 2000 ? 2600 : Math.min(distTd, 1600);
    const ahead = terrainAhead(world, look);
    const clearance = ahead > 0 ? (distTd < 2000 ? Math.min(ahead + 60, 300) : ahead + 60) : 0;
    targetAlt = Math.max(glideAlt, clearance);
    // And never descend into the ground under the plane itself: the slope ahead can
    // fall while the slope under the plane still rises. Close to the touchdown point
    // the runway is flat, so this only applies further out.
    if (distTd > 800) targetAlt = Math.max(targetAlt, world.heightAt(plane.x, plane.z) + 80);
    // Slow down early: flaps and 0.4 throttle from 2.5 km out, so the turn radius
    // on final is small enough to line up with the runway.
    ctrl.flaps = distance < 2500;
    ctrl.throttle = distance > 2500 ? 0.55 : 0.4;
    // Feed the slope in: a proportional stick alone flies above it, because it needs
    // a constant pitch to descend at all. -0.23 of stick is about the 0.08 glide.
    pitchFeed = -0.23;
    // Flare late and gently: only under 10 m, and only down to -0.2 of stick (about
    // -2 m/s at landing speed, a soft touchdown). Flaring earlier or harder makes the
    // plane fall behind the glide and climb away instead of landing.
    flare = plane.alt < 10 && distTd < 300;
  }
  const aimDx = aimX - plane.x;
  const aimDz = aimZ - plane.z;
  const desiredHeading = Math.atan2(aimDx, -aimDz);
  const headingError = wrapAngle(desiredHeading - plane.heading);
  ctrl.roll = Math.max(-1, Math.min(1, headingError * 1.6));
  const altError = targetAlt - plane.alt;
  ctrl.pitch = Math.max(-0.9, Math.min(0.9, altError * 0.015 + pitchFeed));
  if (flare) ctrl.pitch = Math.max(ctrl.pitch, -0.2);
  return ctrl;
}

/** Put the plane somewhere in the air, ready to fly. */
function placePlane(world, x, z, alt, heading, speed, throttle, flaps) {
  const plane = world.state.plane;
  plane.x = x;
  plane.z = z;
  plane.alt = alt;
  plane.heading = heading;
  plane.pitch = 0;
  plane.roll = 0;
  plane.speed = speed;
  plane.vs = 0;
  plane.throttle = throttle;
  plane.flaps = flaps;
  plane.onGround = false;
  plane.airborneOnce = true;
}

/** Step the world with the autopilot until `stop(events)` or the second limit. */
function flyFor(world, seconds, stop) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    const events = world.step(STEP, autopilot(world));
    if (stop && stop(events, world)) return events;
  }
  return 0;
}

/**
 * Set `world` to the named scene (cover, ring, land or done; any other name is cover)
 * and return the screen to draw over it.
 */
export function stageShot(name, world) {
  const home = { x: 4600, z: 900 };
  if (name === 'ring') {
    world.reset('cincin');
    const ring = world.state.rings[0];
    const dx = ring.x - 500;
    const dz = ring.z - 500;
    placePlane(world, dx, dz, ring.alt, Math.atan2(ring.x - dx, -(ring.z - dz)), 62, 0.6, false);
    flyFor(world, 14, (events) => (events & EVENT_RING) !== 0);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'land') {
    world.reset('mendarat');
    placePlane(world, home.x + 1700, home.z, 95, -Math.PI / 2, 55, 0.35, true);
    flyFor(world, 24, (events) => (events & EVENT_TOUCHDOWN) !== 0);
    flyFor(world, 1.2, null);
    return { screen: SCREEN_PLAY };
  }
  if (name === 'done') {
    world.reset('pos');
    flyFor(world, 1300, (events) => (events & (EVENT_COMPLETE | EVENT_CRASH)) !== 0);
    return { screen: world.state.status === 'complete' ? SCREEN_DONE : SCREEN_OVER };
  }
  world.reset('mendarat');
  placePlane(world, home.x + 1500, home.z, 150, -Math.PI / 2, 60, 0.55, false);
  flyFor(world, 3, null);
  return { screen: SCREEN_PLAY };
}
