// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred, the margin filled with the
// backdrop colour. One consistent warm tropical style: sky and sea gradients, low-poly
// island cells, a built-looking turboprop in the frame, and instruments that look flown.
import { FIELD, FOV, ISLANDS, MISSIONS, PALETTE, RINGS, STRIPS } from './config.js';
import { heightAt } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_DONE = 'done';

/** The mission cards on the title screen, in logical coordinates. */
export const TITLE_CARDS = MISSIONS.map((mission, index) => ({
  id: mission.id,
  x: 100 + index * 360,
  y: 428,
  width: 340,
  height: 158,
}));

/** The mission card holding (x, y) in logical coordinates, or null. */
export function titleCardAt(x, y) {
  for (const card of TITLE_CARDS) {
    if (x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height) return card.id;
  }
  return null;
}

const CELL = 500;
const WORLD_HALF = 12000;
const GRID = (WORLD_HALF * 2) / CELL;

function lerpColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
  return `rgb(${r},${g},${bl})`;
}

function terrainColor(height, cellX, cellZ) {
  if (height <= 12) return PALETTE.sand;
  if (height <= 80) return (cellX + cellZ) % 2 === 0 ? PALETTE.rice : PALETTE.field;
  if (height <= 320) return PALETTE.forest;
  if (height <= 600) return PALETTE.jungle;
  if (height <= 800) return PALETTE.rock;
  return PALETTE.volcano;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function headingDegrees(heading) {
  const degrees = Math.round((heading * 180) / Math.PI) % 360;
  return degrees < 0 ? degrees + 360 : degrees;
}

export function createRenderer(canvas, random) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0, ratio: 1 };
  const focal = FIELD.height / 2 / Math.tan(FOV / 2);
  const camera = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0, pitch: 0, ready: false };
  let lastNow = 0;

  // The terrain grid, built once: every cell's four corner heights, its centre and its colour.
  const cells = [];
  for (let gz = 0; gz < GRID; gz += 1) {
    for (let gx = 0; gx < GRID; gx += 1) {
      const x0 = -WORLD_HALF + gx * CELL;
      const z0 = -WORLD_HALF + gz * CELL;
      const h00 = heightAt(x0, z0);
      const h10 = heightAt(x0 + CELL, z0);
      const h01 = heightAt(x0, z0 + CELL);
      const h11 = heightAt(x0 + CELL, z0 + CELL);
      const avg = (h00 + h10 + h01 + h11) / 4;
      if (avg <= 0.5) continue;
      cells.push({
        x0, z0, x1: x0 + CELL, z1: z0 + CELL,
        h00, h10, h01, h11, avg,
        cx: x0 + CELL / 2, cz: z0 + CELL / 2,
        color: terrainColor(avg, gx, gz),
      });
    }
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align) {
    if (!fonts.has(size)) fonts.set(size, `bold ${size}px ${'system-ui, -apple-system, "Segoe UI", sans-serif'}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  function panel(x, y, width, height) {
    context.fillStyle = PALETTE.panel;
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(x, y, width, height, 10);
    context.fill();
    context.stroke();
  }

  /** Split `value` into lines no wider than `maxWidth` pixels at the current font. */
  function wrapLines(value, maxWidth) {
    const words = value.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function bar(x, y, width, height, fraction, color) {
    context.fillStyle = 'rgba(0,0,0,0.45)';
    context.fillRect(x, y, width, height);
    context.fillStyle = color;
    context.fillRect(x, y, width * Math.max(0, Math.min(1, fraction)), height);
    context.strokeStyle = 'rgba(255,255,255,0.35)';
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.ratio = ratio;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function project(x, y, z) {
    const dx = x - camera.x;
    const dy = y - camera.y;
    const dz = z - camera.z;
    const cz = dx * camera.fx + dy * camera.fy + dz * camera.fz;
    if (cz < 1) return null;
    const cx = dx * camera.rx + dy * camera.ry + dz * camera.rz;
    const cy = dx * camera.ux + dy * camera.uy + dz * camera.uz;
    return { x: FIELD.width / 2 + (cx / cz) * focal, y: FIELD.height / 2 - (cy / cz) * focal, z: cz };
  }

  function updateCamera(state, look, dt) {
    const plane = state.plane;
    const fx = Math.sin(plane.heading);
    const fz = -Math.cos(plane.heading);
    // Chase camera: behind and above the plane, looking ahead of it, easing after it.
    const wantX = plane.x - fx * 38;
    const wantY = plane.alt + 11;
    const wantZ = plane.z - fz * 38;
    const ease = camera.ready ? 1 - Math.exp(-dt * 5) : 1;
    camera.x += (wantX - camera.x) * ease;
    camera.y += (wantY - camera.y) * ease;
    camera.z += (wantZ - camera.z) * ease;
    camera.ready = true;
    let lx = plane.x + fx * 90;
    let ly = plane.alt + 1;
    let lz = plane.z + fz * 90;
    // The mouse look turns the view around the plane.
    const cos = Math.cos(look.yaw);
    const sin = Math.sin(look.yaw);
    const rx = lx - camera.x;
    const rz = lz - camera.z;
    lx = camera.x + rx * cos - rz * sin;
    lz = camera.z + rx * sin + rz * cos;
    ly += look.pitch * 60;
    let fdx = lx - camera.x;
    let fdy = ly - camera.y;
    let fdz = lz - camera.z;
    const fl = Math.sqrt(fdx * fdx + fdy * fdy + fdz * fdz) || 1;
    fdx /= fl;
    fdy /= fl;
    fdz /= fl;
    camera.fx = fdx;
    camera.fy = fdy;
    camera.fz = fdz;
    camera.pitch = Math.asin(Math.max(-1, Math.min(1, fdy)));
    // Right is forward x world-up; up is right x forward. The camera rolls with the
    // plane: rotating right and up around forward by the bank (times 0.35).
    let brx = -fdz;
    let brz = fdx;
    const brl = Math.sqrt(brx * brx + brz * brz) || 1;
    brx /= brl;
    brz /= brl;
    // u0 = r0 x f, the level up vector.
    let bux = -brz * fdy;
    let buy = brz * fdx - brx * fdz;
    let buz = brx * fdy;
    const bul = Math.sqrt(bux * bux + buy * buy + buz * buz) || 1;
    bux /= bul;
    buy /= bul;
    buz /= bul;
    const roll = plane.roll * 0.35;
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    camera.rx = brx * cr - bux * sr;
    camera.ry = -buy * sr;
    camera.rz = brz * cr - buz * sr;
    camera.ux = bux * cr + brx * sr;
    camera.uy = buy * cr;
    camera.uz = buz * cr + brz * sr;
  }

  function drawSkySea(state) {
    const horizonY = FIELD.height / 2 - Math.tan(camera.pitch) * focal;
    const sky = context.createLinearGradient(0, 0, 0, Math.max(0, horizonY));
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(1, PALETTE.skyHorizon);
    context.fillStyle = sky;
    context.fillRect(0, 0, FIELD.width, Math.max(0, horizonY));
    if (horizonY < FIELD.height) {
      const sea = context.createLinearGradient(0, Math.max(0, horizonY), 0, FIELD.height);
      sea.addColorStop(0, PALETTE.seaShallow);
      sea.addColorStop(1, PALETTE.seaDeep);
      context.fillStyle = sea;
      context.fillRect(0, Math.max(0, horizonY), FIELD.width, FIELD.height - Math.max(0, horizonY));
      // Sun glint: a bright streak on the water under the sun.
      const sunX = FIELD.width * 0.68;
      context.fillStyle = 'rgba(255, 243, 196, 0.35)';
      context.beginPath();
      context.moveTo(sunX - 26, Math.max(0, horizonY) + 6);
      context.lineTo(sunX + 26, Math.max(0, horizonY) + 6);
      context.lineTo(sunX + 90, FIELD.height);
      context.lineTo(sunX - 90, FIELD.height);
      context.closePath();
      context.fill();
    }
    // The sun itself, high in the sky.
    const sun = project(camera.x + 4000, camera.y + 2600, camera.z - 6000);
    if (sun) {
      context.fillStyle = PALETTE.sun;
      context.beginPath();
      context.arc(sun.x, sun.y, 26, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255, 243, 196, 0.35)';
      context.beginPath();
      context.arc(sun.x, sun.y, 44, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawTerrain() {
    const visible = [];
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const dx = cell.cx - camera.x;
      const dy = cell.avg - camera.y;
      const dz = cell.cz - camera.z;
      const depth = dx * camera.fx + dy * camera.fy + dz * camera.fz;
      if (depth < 60 || depth > 9800) continue;
      const px = FIELD.width / 2 + ((dx * camera.rx + dy * camera.ry + dz * camera.rz) / depth) * focal;
      if (px < -400 || px > FIELD.width + 400) continue;
      visible.push({ cell, depth });
    }
    visible.sort((a, b) => b.depth - a.depth);
    for (let index = 0; index < visible.length; index += 1) {
      const { cell, depth } = visible[index];
      const p00 = project(cell.x0, cell.h00, cell.z0);
      const p10 = project(cell.x1, cell.h10, cell.z0);
      const p11 = project(cell.x1, cell.h11, cell.z1);
      const p01 = project(cell.x0, cell.h01, cell.z1);
      if (!p00 || !p10 || !p11 || !p01) continue;
      const fog = Math.min(0.62, depth / 14000);
      context.fillStyle = lerpColor(cell.color, PALETTE.skyHorizon, fog);
      context.beginPath();
      context.moveTo(p00.x, p00.y);
      context.lineTo(p10.x, p10.y);
      context.lineTo(p11.x, p11.y);
      context.lineTo(p01.x, p01.y);
      context.closePath();
      context.fill();
    }
  }

  function drawStrip(strip) {
    const halfL = strip.halfLength;
    const halfW = strip.halfWidth;
    const dx = Math.sin(strip.heading);
    const dz = -Math.cos(strip.heading);
    const px = Math.cos(strip.heading);
    const pz = Math.sin(strip.heading);
    const corners = [
      [strip.x - dx * halfL - px * halfW, strip.z - dz * halfL - pz * halfW],
      [strip.x + dx * halfL - px * halfW, strip.z + dz * halfL - pz * halfW],
      [strip.x + dx * halfL + px * halfW, strip.z + dz * halfL + pz * halfW],
      [strip.x - dx * halfL + px * halfW, strip.z - dz * halfL + pz * halfW],
    ];
    const projected = corners.map(([x, z]) => project(x, 0.6, z));
    if (projected.some((point) => point === null)) return;
    context.fillStyle = PALETTE.runway;
    context.beginPath();
    context.moveTo(projected[0].x, projected[0].y);
    for (let index = 1; index < 4; index += 1) context.lineTo(projected[index].x, projected[index].y);
    context.closePath();
    context.fill();
    // Centreline dashes and the threshold bars at both ends.
    context.fillStyle = PALETTE.runwayMark;
    for (let along = -halfL + 90; along < halfL - 60; along += 120) {
      const cx = strip.x + dx * along;
      const cz = strip.z + dz * along;
      const a = project(cx - dx * 22, 0.8, cz - dz * 22);
      const b = project(cx + dx * 22, 0.8, cz + dz * 22);
      if (!a || !b) continue;
      context.lineWidth = Math.max(1, 900 / a.z);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }

  function drawRings(state) {
    for (let index = 0; index < state.rings.length; index += 1) {
      const ring = state.rings[index];
      const centre = project(ring.x, ring.alt, ring.z);
      if (!centre || centre.z < 8) continue;
      const radius = (focal * ring.radius) / centre.z;
      if (radius < 3) continue;
      const passed = ring.passed;
      context.strokeStyle = passed ? PALETTE.good : PALETTE.ring;
      context.lineWidth = Math.max(2, radius * 0.14);
      context.beginPath();
      context.ellipse(centre.x, centre.y, radius, radius * 0.92, 0, 0, Math.PI * 2);
      context.stroke();
      if (!passed) {
        context.strokeStyle = PALETTE.ringInner;
        context.lineWidth = Math.max(1, radius * 0.05);
        context.beginPath();
        context.ellipse(centre.x, centre.y, radius * 0.78, radius * 0.72, 0, 0, Math.PI * 2);
        context.stroke();
      }
    }
  }

  function drawClouds(state) {
    context.fillStyle = 'rgba(255, 255, 255, 0.82)';
    for (let index = 0; index < state.clouds.length; index += 1) {
      const cloud = state.clouds[index];
      const centre = project(cloud.x, cloud.alt, cloud.z);
      if (!centre || centre.z < 20) continue;
      const radius = (focal * cloud.size) / centre.z;
      if (radius < 4 || radius > 900) continue;
      context.beginPath();
      context.ellipse(centre.x, centre.y, radius, radius * 0.32, 0, 0, Math.PI * 2);
      context.ellipse(centre.x - radius * 0.5, centre.y + radius * 0.06, radius * 0.6, radius * 0.26, 0, 0, Math.PI * 2);
      context.ellipse(centre.x + radius * 0.5, centre.y + radius * 0.05, radius * 0.55, radius * 0.24, 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawAircraft(state, now) {
    const plane = state.plane;
    const cx = FIELD.width / 2;
    const cy = FIELD.height * 0.60;
    context.save();
    context.translate(cx, cy);
    context.rotate(plane.roll * 0.85);
    // Main wings.
    context.fillStyle = PALETTE.planeWhite;
    context.strokeStyle = PALETTE.planeDark;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-14, -6);
    context.lineTo(-86, 14);
    context.lineTo(-80, 30);
    context.lineTo(-12, 16);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(14, -6);
    context.lineTo(86, 14);
    context.lineTo(80, 30);
    context.lineTo(12, 16);
    context.closePath();
    context.fill();
    context.stroke();
    // Tailplane.
    context.beginPath();
    context.moveTo(-10, 44);
    context.lineTo(-38, 56);
    context.lineTo(-34, 64);
    context.lineTo(-8, 56);
    context.closePath();
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(10, 44);
    context.lineTo(38, 56);
    context.lineTo(34, 64);
    context.lineTo(8, 56);
    context.closePath();
    context.fill();
    context.stroke();
    // Fuselage, nose up.
    context.fillStyle = PALETTE.planeWhite;
    context.beginPath();
    context.moveTo(0, -78);
    context.quadraticCurveTo(13, -60, 14, -30);
    context.lineTo(15, 38);
    context.quadraticCurveTo(14, 56, 0, 58);
    context.quadraticCurveTo(-14, 56, -15, 38);
    context.lineTo(-14, -30);
    context.quadraticCurveTo(-13, -60, 0, -78);
    context.closePath();
    context.fill();
    context.stroke();
    // Orange stripe and windows.
    context.fillStyle = PALETTE.planeOrange;
    context.fillRect(-14, -18, 28, 7);
    context.fillStyle = PALETTE.planeDark;
    for (let index = 0; index < 4; index += 1) {
      context.beginPath();
      context.arc(0, -44 + index * 9, 2.2, 0, Math.PI * 2);
      context.fill();
    }
    // Vertical fin on the tail.
    context.fillStyle = PALETTE.planeOrange;
    context.beginPath();
    context.moveTo(-9, 52);
    context.lineTo(9, 52);
    context.lineTo(0, 30);
    context.closePath();
    context.fill();
    // Spinning propeller at the nose.
    const spin = (now / 1000) * 22;
    context.fillStyle = 'rgba(255, 255, 255, 0.20)';
    context.beginPath();
    context.arc(0, -80, 24, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(46, 50, 56, 0.75)';
    context.lineWidth = 3;
    for (let index = 0; index < 2; index += 1) {
      const angle = spin + (index * Math.PI) / 2;
      context.beginPath();
      context.moveTo(0 - Math.cos(angle) * 22, -80 - Math.sin(angle) * 22);
      context.lineTo(0 + Math.cos(angle) * 22, -80 + Math.sin(angle) * 22);
      context.stroke();
    }
    context.restore();
  }

  function drawGauge(cx, cy, radius, label, value, max, digital) {
    context.fillStyle = PALETTE.panel;
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    for (let index = 0; index <= 10; index += 1) {
      const angle = -Math.PI * 0.75 + (index / 10) * Math.PI * 1.5;
      const inner = radius - (index % 5 === 0 ? 10 : 6);
      context.strokeStyle = PALETTE.muted;
      context.lineWidth = index % 5 === 0 ? 2 : 1;
      context.beginPath();
      context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      context.lineTo(cx + Math.cos(angle) * (radius - 2), cy + Math.sin(angle) * (radius - 2));
      context.stroke();
    }
    const fraction = Math.max(0, Math.min(1, value / max));
    const needle = -Math.PI * 0.75 + fraction * Math.PI * 1.5;
    context.strokeStyle = PALETTE.text;
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(cx, cy);
    context.lineTo(cx + Math.cos(needle) * (radius - 12), cy + Math.sin(needle) * (radius - 12));
    context.stroke();
    context.fillStyle = PALETTE.planeOrange;
    context.beginPath();
    context.arc(cx, cy, 4, 0, Math.PI * 2);
    context.fill();
    text(label, cx, cy + radius - 2, 13, PALETTE.muted, 'center');
    text(digital, cx, cy + radius + 16, 15, PALETTE.text, 'center');
  }

  function drawCompass(cx, cy, radius, heading) {
    context.fillStyle = PALETTE.panel;
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    const marks = [['U', 0], ['TL', 45], ['T', 90], ['TG', 135], ['S', 180], ['BD', 225], ['B', 270], ['BL', 315]];
    for (const [label, degrees] of marks) {
      const angle = ((degrees - headingDegrees(heading)) * Math.PI) / 180 - Math.PI / 2;
      const x = cx + Math.cos(angle) * (radius - 14);
      const y = cy + Math.sin(angle) * (radius - 14);
      text(label, x, y + 4, 12, label === 'U' ? PALETTE.planeOrange : PALETTE.text, 'center');
    }
    context.strokeStyle = PALETTE.planeOrange;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(cx, cy - radius + 4);
    context.lineTo(cx - 5, cy - radius + 14);
    context.lineTo(cx + 5, cy - radius + 14);
    context.closePath();
    context.fill();
    text(`${headingDegrees(heading)}°`, cx, cy + radius + 16, 15, PALETTE.text, 'center');
  }

  function drawHud(state, target, showMessage) {
    const plane = state.plane;
    // Top-left: the flight numbers.
    panel(16, 14, 250, 108);
    text(`KEC  ${Math.round(plane.speed * 1.94384)} kt`, 30, 42, 20, PALETTE.text);
    text(`TINGGI  ${Math.round(plane.alt * 3.28084)} ft`, 30, 68, 20, PALETTE.text);
    text(`ARAH  ${headingDegrees(plane.heading)}°`, 30, 94, 20, PALETTE.text);
    text(`THROTTLE ${Math.round(plane.throttle * 100)}%${plane.flaps ? '  ·  FLAP' : ''}`, 30, 116, 14, PALETTE.muted);
    // Compass tape across the top.
    panel(FIELD.width / 2 - 190, 14, 380, 30);
    const centreDeg = headingDegrees(plane.heading);
    context.save();
    context.beginPath();
    context.rect(FIELD.width / 2 - 190, 14, 380, 30);
    context.clip();
    for (let deg = centreDeg - 60; deg <= centreDeg + 60; deg += 5) {
      const norm = ((deg % 360) + 360) % 360;
      const x = FIELD.width / 2 + (deg - centreDeg) * 3;
      const major = norm % 45 === 0;
      context.strokeStyle = major ? PALETTE.text : PALETTE.muted;
      context.lineWidth = major ? 2 : 1;
      context.beginPath();
      context.moveTo(x, 18);
      context.lineTo(x, major ? 30 : 25);
      context.stroke();
      if (major) {
        const label = norm === 0 ? 'U' : norm === 90 ? 'T' : norm === 180 ? 'S' : norm === 270 ? 'B' : `${norm}°`;
        text(label, x, 42, 12, PALETTE.text, 'center');
      }
    }
    context.restore();
    // Top-right: the mission, the fuel and the damage.
    panel(FIELD.width - 266, 14, 250, 128);
    text(state.mission.name.toUpperCase(), FIELD.width - 252, 40, 16, PALETTE.text);
    context.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
    const goalLines = wrapLines(state.mission.goal, 222).slice(0, 2);
    for (let index = 0; index < goalLines.length; index += 1) {
      text(goalLines[index], FIELD.width - 252, 60 + index * 15, 12, PALETTE.muted);
    }
    text('BAHAN BAKAR', FIELD.width - 252, 96, 11, PALETTE.muted);
    bar(FIELD.width - 252, 100, 222, 9, plane.fuel / 100, plane.fuel < 20 ? PALETTE.bad : PALETTE.good);
    text('KERUSAKAN', FIELD.width - 252, 124, 11, PALETTE.muted);
    bar(FIELD.width - 252, 128, 222, 9, plane.damage / 100, plane.damage > 50 ? PALETTE.bad : PALETTE.warn);
    // Mission progress under the fuel panel.
    let progress = '';
    if (state.mission.id === 'cincin') progress = `Cincin ${state.mission.ringIndex}/5   ·   Skor ${state.score}   ·   ${formatTime(state.time)}`;
    else if (state.mission.id === 'pos') progress = `Surat ${state.mission.deliveries}/3   ·   Skor ${state.score}   ·   ${formatTime(state.time)}`;
    else progress = `Skor ${state.score}   ·   ${formatTime(state.time)}`;
    text(progress, FIELD.width - 252, 158, 14, PALETTE.text);
    // The gauges along the bottom.
    drawGauge(64, 648, 42, 'KEC', plane.speed, 100, `${Math.round(plane.speed * 1.94384)} kt`);
    drawGauge(168, 648, 42, 'TINGGI', plane.alt, 900, `${Math.round(plane.alt * 3.28084)} ft`);
    drawCompass(272, 648, 42, plane.heading);
    // The target marker: a diamond on the next ring or strip, with its distance.
    if (target) {
      const point = project(target.x, target.alt + 4, target.z);
      if (point && point.z > 4) {
        const distance = Math.round(Math.sqrt((target.x - plane.x) ** 2 + (target.z - plane.z) ** 2 + (target.alt - plane.alt) ** 2));
        context.strokeStyle = PALETTE.ring;
        context.lineWidth = 3;
        const size = 14;
        context.beginPath();
        context.moveTo(point.x, point.y - size);
        context.lineTo(point.x + size, point.y);
        context.lineTo(point.x, point.y + size);
        context.lineTo(point.x - size, point.y);
        context.closePath();
        context.stroke();
        text(`${target.name}  ${distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`}`, point.x, point.y - 24, 15, PALETTE.text, 'center');
      } else {
        // Behind the camera: an arrow at the screen edge points the way.
        const angle = Math.atan2(target.x - plane.x, -(target.z - plane.z)) - plane.heading;
        const edgeX = FIELD.width / 2 + Math.sin(angle) * 420;
        text('▶', Math.max(40, Math.min(FIELD.width - 40, edgeX)), 330, 26, PALETTE.ring, 'center');
        text(target.name, Math.max(60, Math.min(FIELD.width - 60, edgeX)), 356, 14, PALETTE.text, 'center');
      }
    }
    // Controls hint, bottom right.
    text('W/S throttle · Panah terbang · A/D kemudi · F flap · B rem · P jeda · M suara', FIELD.width - 16, 706, 13, PALETTE.muted, 'right');
    // A message across the middle, while it lasts, wrapped so it never runs off the
    // screen. Not on the done or over screens: the panel there already says it.
    if (showMessage && state.time < state.messageUntil && state.message) {
      context.font = 'bold 24px system-ui, -apple-system, "Segoe UI", sans-serif';
      const lines = wrapLines(state.message, 900).slice(0, 2);
      context.textAlign = 'center';
      context.lineWidth = 5;
      context.strokeStyle = 'rgba(10, 20, 30, 0.8)';
      context.fillStyle = PALETTE.text;
      for (let index = 0; index < lines.length; index += 1) {
        const y = 250 + index * 30;
        context.strokeText(lines[index], FIELD.width / 2, y);
        context.fillText(lines[index], FIELD.width / 2, y);
      }
    }
  }

  function drawTitle(state, bests) {
    // A parked plane on the home runway, seen from the chase camera.
    drawSkySea(state);
    drawTerrain();
    for (const strip of STRIPS) drawStrip(strip);
    drawClouds(state);
    drawAircraft(state, 0);
    context.fillStyle = 'rgba(8, 18, 28, 0.45)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    text('PENERBANGAN', FIELD.width / 2, 108, 64, PALETTE.text, 'center');
    text('NUSANTARA', FIELD.width / 2, 168, 64, PALETTE.planeOrange, 'center');
    text('Pesawat pos kecil antar pulau — terbang, antar surat, mendarat dengan selamat.', FIELD.width / 2, 200, 19, PALETTE.muted, 'center');
    for (let index = 0; index < MISSIONS.length; index += 1) {
      const mission = MISSIONS[index];
      const card = TITLE_CARDS[index];
      const best = bests[mission.id] || 0;
      panel(card.x, card.y, card.width, card.height);
      text(`${mission.key}. ${mission.name}`, card.x + 16, card.y + 34, 19, PALETTE.text);
      context.font = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
      const goalLines = wrapLines(mission.goal, card.width - 32).slice(0, 2);
      for (let line = 0; line < goalLines.length; line += 1) {
        text(goalLines[line], card.x + 16, card.y + 60 + line * 17, 13, PALETTE.muted);
      }
      context.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
      const detailLines = wrapLines(mission.detail, card.width - 32).slice(0, 2);
      for (let line = 0; line < detailLines.length; line += 1) {
        text(detailLines[line], card.x + 16, card.y + 100 + line * 16, 12, PALETTE.muted);
      }
      text(best > 0 ? `Terbaik: ${best}` : 'Belum dimainkan', card.x + 16, card.y + 142, 14, best > 0 ? PALETTE.good : PALETTE.muted);
    }
    text('Klik misi atau tekan 1 / 2 / 3 — lalu Enter untuk terbang. W/S throttle, panah untuk terbang, A/D kemudi, F flap, B rem.', FIELD.width / 2, 628, 15, PALETTE.text, 'center');
  }

  function drawPanelScreen(title, lines, hint) {
    context.fillStyle = 'rgba(8, 18, 28, 0.55)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    panel(FIELD.width / 2 - 300, 210, 600, 150 + lines.length * 30);
    text(title, FIELD.width / 2, 268, 40, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, 312 + index * 30, 18, PALETTE.muted, 'center');
    }
    text(hint, FIELD.width / 2, 330 + lines.length * 30, 16, PALETTE.text, 'center');
  }

  function draw(state, screen, bests, look, dt, target, now) {
    const plane = state.plane;
    if (screen === SCREEN_TITLE) {
      // The title camera drifts slowly over the parked plane, facing back along the
      // runway toward the island and its volcano.
      const drift = now / 1000 / 60;
      plane.heading = -Math.PI / 2 + Math.sin(drift) * 0.12;
      updateCamera(state, { yaw: 0, pitch: 0 }, dt);
      drawTitle(state, bests);
      return;
    }
    updateCamera(state, look, dt);
    drawSkySea(state);
    drawTerrain();
    for (const strip of STRIPS) drawStrip(strip);
    drawRings(state);
    drawClouds(state);
    if (screen !== SCREEN_OVER) drawAircraft(state, now);
    drawHud(state, target, screen === SCREEN_PLAY);
    if (screen === SCREEN_PAUSED) {
      drawPanelScreen('JEDA', [`${state.mission.name} — skor ${state.score}`], 'Tekan P atau Enter untuk lanjut.');
    } else if (screen === SCREEN_OVER) {
      const best = Math.max(bests[state.mission.id] || 0, state.score);
      drawPanelScreen('JATUH!', [state.message || 'Pesawat jatuh.', `Skor ${state.score}   ·   Terbaik ${best}`, `Waktu ${formatTime(state.time)}`], 'Tekan Enter untuk terbang lagi, R untuk ganti misi.');
    } else if (screen === SCREEN_DONE) {
      const best = Math.max(bests[state.mission.id] || 0, state.score);
      drawPanelScreen('MISI SELESAI!', [`${state.mission.name} — skor ${state.score}`, `Terbaik ${best}   ·   Waktu ${formatTime(state.time)}`], 'Tekan Enter untuk terbang lagi, R untuk ganti misi.');
    }
  }

  return {
    draw,
    /** Client pixels to logical playfield coordinates. */
    toLogical(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.x) / view.scale,
        y: (clientY - rect.top - view.y) / view.scale,
      };
    },
    resize,
  };
}
