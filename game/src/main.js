// The boot and the frame loop. One world, one renderer, one input, one audio engine.
// Title, play, paused, over and done are screens over the same world; the ?shot=
// scenes are staged once and drawn once, with no loop, so a screenshot is exactly
// what the game shows.
import { MISSIONS } from './config.js';
import { EVENT_COMPLETE, EVENT_CRASH, EVENT_DELIVER, EVENT_RING, EVENT_TOUCHDOWN, createWorld } from './world.js';
import { ACTION_CONFIRM, ACTION_MISSION_1, ACTION_MISSION_2, ACTION_MISSION_3, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_DONE, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, titleCardAt } from './render.js';
import { stageShot } from './shots.js';

const BEST_KEY = 'penerbangan-nusantara-best';
const NEUTRAL = { pitch: 0, roll: 0, throttle: 0, rudder: 0, flaps: false, brake: false };

function loadBests() {
  try {
    const saved = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    return { cincin: saved.cincin || 0, mendarat: saved.mendarat || 0, pos: saved.pos || 0 };
  } catch (error) {
    return { cincin: 0, mendarat: 0, pos: 0 };
  }
}

function saveBest(bests, missionId, score) {
  if (score > (bests[missionId] || 0)) {
    bests[missionId] = score;
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(bests));
    } catch (error) {
      // A best score is nice to keep, not essential.
    }
  }
}

function boot() {
  const canvas = document.getElementById('game');
  const world = createWorld();
  const input = createInput(canvas);
  const audio = createAudio();
  const renderer = createRenderer(canvas, world.random);
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());

  const shot = new URLSearchParams(window.location.search).get('shot');
  if (shot) {
    // A screenshot scene: stage it once, draw it once, and stop. The prop and the
    // title drift use a fixed clock so the same seed always gives the same frame.
    const staged = stageShot(shot, world);
    renderer.draw(world.state, staged.screen, loadBests(), { yaw: 0, pitch: 0 }, 0, world.nextTarget(), 1234);
    document.title = `Penerbangan Nusantara — ${shot}`;
    return;
  }

  const bests = loadBests();
  let screen = SCREEN_TITLE;
  let selected = 'pos';
  let look = { yaw: 0, pitch: 0 };
  let lastNow = performance.now();
  world.reset(selected);

  function startMission(missionId) {
    selected = missionId;
    world.reset(missionId);
    look = { yaw: 0, pitch: 0 };
    screen = SCREEN_PLAY;
  }

  function finish() {
    const missionId = world.state.mission.id;
    saveBest(bests, missionId, world.state.score);
    audio.update(0, 0, false);
    screen = world.state.status === 'complete' ? SCREEN_DONE : SCREEN_OVER;
  }

  function loop(now) {
    const dt = Math.max(0, Math.min(0.05, (now - lastNow) / 1000));
    lastNow = now;
    // Read this frame's input before update() clears the one-shot presses and the
    // click. The flaps toggle is applied here so F works the same frame it is hit.
    const actions = input.takeActions();
    input.takeFlapsToggle();
    const ctrl = {
      pitch: input.pitch(),
      roll: input.roll(),
      throttle: input.throttleValue(),
      rudder: input.rudder(),
      flaps: input.flapsDown(),
      brake: input.braking(),
    };
    look = input.look();
    const pointer = input.pointer();
    const click = pointer.clicked ? { x: pointer.clickX, y: pointer.clickY } : null;
    if (actions & ACTION_MUTE) audio.toggleMute();
    if (actions || click) audio.unlock();

    if (screen === SCREEN_TITLE) {
      world.step(dt, NEUTRAL);
      audio.update(0, 0, false);
      if (actions & ACTION_MISSION_1) startMission('cincin');
      else if (actions & ACTION_MISSION_2) startMission('mendarat');
      else if (actions & ACTION_MISSION_3) startMission('pos');
      else if (actions & ACTION_CONFIRM) startMission(selected);
      if (click) {
        const logical = renderer.toLogical(click.x, click.y);
        const missionId = titleCardAt(logical.x, logical.y);
        if (missionId) startMission(missionId);
      }
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
      } else {
        const events = world.step(dt, ctrl);
        const plane = world.state.plane;
        if (events & EVENT_RING) audio.ring();
        if (events & EVENT_TOUCHDOWN) audio.thud();
        if (events & EVENT_DELIVER) audio.deliver();
        if (events & EVENT_CRASH) audio.crash();
        if (events & EVENT_COMPLETE) audio.deliver();
        audio.update(plane.throttle, plane.speed, !plane.onGround);
        if (world.state.status !== 'flying') finish();
      }
    } else if (screen === SCREEN_PAUSED) {
      audio.update(0, 0, false);
      if (actions & ACTION_PAUSE || actions & ACTION_CONFIRM) screen = SCREEN_PLAY;
      else if (actions & ACTION_RESTART) {
        world.reset(selected);
        screen = SCREEN_TITLE;
      }
    } else {
      // Over or done.
      if (actions & ACTION_CONFIRM) startMission(world.state.mission.id);
      else if (actions & ACTION_RESTART) {
        world.reset(selected);
        screen = SCREEN_TITLE;
      }
    }

    renderer.draw(world.state, screen, bests, look, dt, world.nextTarget(), now);
    input.update(dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

boot();
