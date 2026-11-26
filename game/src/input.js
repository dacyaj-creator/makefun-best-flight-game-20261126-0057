// Keyboard and pointer input. Held keys give the stick and throttle directly; one-shot
// presses (confirm, pause, mute, restart, mission choice, flaps) are queued as bit flags
// and taken once by the loop, so a press between two frames is never lost or counted
// twice. Dragging the mouse looks around; the look offset fades back to centre.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;
export const ACTION_RESTART = 8;
export const ACTION_MISSION_1 = 16;
export const ACTION_MISSION_2 = 32;
export const ACTION_MISSION_3 = 64;

const PITCH_UP = new Set(['ArrowUp']);
const PITCH_DOWN = new Set(['ArrowDown']);
const ROLL_LEFT = new Set(['ArrowLeft']);
const ROLL_RIGHT = new Set(['ArrowRight']);
const THROTTLE_UP = new Set(['KeyW']);
const THROTTLE_DOWN = new Set(['KeyS']);
const RUDDER_LEFT = new Set(['KeyA']);
const RUDDER_RIGHT = new Set(['KeyD']);
const BRAKE = new Set(['KeyB']);
const FLAPS = new Set(['KeyF']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);
const RESTART = new Set(['KeyR']);
const MISSION = { Digit1: ACTION_MISSION_1, Digit2: ACTION_MISSION_2, Digit3: ACTION_MISSION_3 };

export function createInput(canvas) {
  let pitchUp = false;
  let pitchDown = false;
  let rollLeft = false;
  let rollRight = false;
  let throttleUp = false;
  let throttleDown = false;
  let rudderLeft = false;
  let rudderRight = false;
  let brake = false;
  let throttle = 0;
  let flaps = false;
  let actions = 0;
  let flapsQueued = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lookYaw = 0;
  let lookPitch = 0;
  const pointer = { x: 0, y: 0, clicked: false, clickX: 0, clickY: 0 };

  function press(event) {
    if (PITCH_UP.has(event.code)) pitchUp = true;
    else if (PITCH_DOWN.has(event.code)) pitchDown = true;
    else if (ROLL_LEFT.has(event.code)) rollLeft = true;
    else if (ROLL_RIGHT.has(event.code)) rollRight = true;
    else if (THROTTLE_UP.has(event.code)) throttleUp = true;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = true;
    else if (RUDDER_LEFT.has(event.code)) rudderLeft = true;
    else if (RUDDER_RIGHT.has(event.code)) rudderRight = true;
    else if (BRAKE.has(event.code)) brake = true;
    else if (FLAPS.has(event.code)) {
      if (!event.repeat) flapsQueued = true;
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (RESTART.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (MISSION[event.code]) {
      if (!event.repeat) actions |= MISSION[event.code];
    } else return;
    event.preventDefault();
  }

  function release(event) {
    if (PITCH_UP.has(event.code)) pitchUp = false;
    else if (PITCH_DOWN.has(event.code)) pitchDown = false;
    else if (ROLL_LEFT.has(event.code)) rollLeft = false;
    else if (ROLL_RIGHT.has(event.code)) rollRight = false;
    else if (THROTTLE_UP.has(event.code)) throttleUp = false;
    else if (THROTTLE_DOWN.has(event.code)) throttleDown = false;
    else if (RUDDER_LEFT.has(event.code)) rudderLeft = false;
    else if (RUDDER_RIGHT.has(event.code)) rudderRight = false;
    else if (BRAKE.has(event.code)) brake = false;
  }

  window.addEventListener('keydown', press);
  window.addEventListener('keyup', release);
  window.addEventListener('blur', () => {
    pitchUp = pitchDown = rollLeft = rollRight = false;
    throttleUp = throttleDown = rudderLeft = rudderRight = brake = false;
  });

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.clickX = event.clientX;
    pointer.clickY = event.clientY;
    pointer.clicked = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (!dragging) return;
    lookYaw += (event.clientX - lastX) * 0.004;
    lookPitch += (event.clientY - lastY) * 0.004;
    lookYaw = Math.max(-0.9, Math.min(0.9, lookYaw));
    lookPitch = Math.max(-0.45, Math.min(0.45, lookPitch));
    lastX = event.clientX;
    lastY = event.clientY;
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  });
  canvas.addEventListener('pointercancel', () => {
    dragging = false;
  });

  return {
    /** -1 to 1: the stick fore and aft (up is climb). */
    pitch() {
      return (pitchUp ? 1 : 0) - (pitchDown ? 1 : 0);
    },
    /** -1 to 1: the stick left and right (right banks right). */
    roll() {
      return (rollRight ? 1 : 0) - (rollLeft ? 1 : 0);
    },
    /** -1 to 1: the rudder pedals. */
    rudder() {
      return (rudderRight ? 1 : 0) - (rudderLeft ? 1 : 0);
    },
    /** True while the brake key is held. */
    braking() {
      return brake;
    },
    /** The throttle lever, 0..1, moved by W and S. */
    throttleValue() {
      return throttle;
    },
    /** The flaps, toggled by F; true means down. */
    flapsDown() {
      return flaps;
    },
    /** The look-around offset from dragging the mouse, in radians. */
    look() {
      return { yaw: lookYaw, pitch: lookPitch };
    },
    /** The pointer in client pixels, and whether it was just clicked. */
    pointer() {
      return pointer;
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** True once when F was pressed since the last call; toggles the flaps. */
    takeFlapsToggle() {
      if (!flapsQueued) return false;
      flapsQueued = false;
      flaps = !flaps;
      return true;
    },
    /** Advance the throttle lever and let the look offset fade back. */
    update(dt) {
      if (throttleUp) throttle = Math.min(1, throttle + dt);
      if (throttleDown) throttle = Math.max(0, throttle - dt);
      if (!dragging) {
        lookYaw += Math.max(-2 * dt, Math.min(2 * dt, -lookYaw));
        lookPitch += Math.max(-2 * dt, Math.min(2 * dt, -lookPitch));
      }
      pointer.clicked = false;
    },
  };
}
