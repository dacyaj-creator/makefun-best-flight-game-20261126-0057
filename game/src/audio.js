// All sound is generated here with WebAudio: an engine hum that follows the throttle,
// wind that follows the speed, and short tones for rings, landings and deliveries. No
// audio file is loaded, and nothing here starts until the player first presses a key
// or clicks, so a quiet page stays quiet. M mutes everything.

export function createAudio() {
  let context = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let windSource = null;
  let windGain = null;
  let windFilter = null;
  let muted = false;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineOsc2 = context.createOscillator();
      engineOsc2.type = 'sine';
      engineOsc2.frequency.value = 110;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineGain);
      engineOsc2.connect(engineGain);
      engineGain.connect(context.destination);
      engineOsc.start();
      engineOsc2.start();

      const length = context.sampleRate * 2;
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
      windSource = context.createBufferSource();
      windSource.buffer = buffer;
      windSource.loop = true;
      windFilter = context.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 500;
      windFilter.Q.value = 0.6;
      windGain = context.createGain();
      windGain.gain.value = 0;
      windSource.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(context.destination);
      windSource.start();
      return true;
    } catch {
      context = null;
      return false;
    }
  }

  function tone(frequency, seconds, type, volume, when) {
    if (!context || muted) return;
    try {
      const osc = context.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.setValueAtTime(volume, context.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + when + seconds);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(context.currentTime + when);
      osc.stop(context.currentTime + when + seconds + 0.05);
    } catch {
      // Sound is garnish: a failed tone never stops the game.
    }
  }

  return {
    /** Call on the first key press or click; harmless before that. */
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
    },
    /** The engine and wind follow the plane: throttle 0..1, speed m/s, airborne or not. */
    update(throttle, speed, airborne) {
      if (!context || muted) return;
      try {
        const now = context.currentTime;
        const rpm = 50 + throttle * 70 + speed * 0.35;
        engineOsc.frequency.setTargetAtTime(rpm, now, 0.1);
        engineOsc2.frequency.setTargetAtTime(rpm * 2, now, 0.1);
        engineGain.gain.setTargetAtTime(airborne ? 0.03 + throttle * 0.05 : 0.02 + throttle * 0.03, now, 0.1);
        windFilter.frequency.setTargetAtTime(300 + speed * 9, now, 0.15);
        windGain.gain.setTargetAtTime(airborne ? Math.min(0.09, speed * 0.0009) : 0, now, 0.15);
      } catch {
        // Keep flying even if the audio graph breaks.
      }
    },
    /** True when the sound is off. */
    isMuted() {
      return muted;
    },
    /** M toggles the sound. */
    toggleMute() {
      muted = !muted;
      if (context) {
        try {
          engineGain.gain.value = 0;
          windGain.gain.value = 0;
        } catch {
          // Nothing to silence.
        }
      }
      return muted;
    },
    /** A bright two-note chime for a ring. */
    ring() {
      tone(880, 0.12, 'sine', 0.12, 0);
      tone(1318, 0.18, 'sine', 0.1, 0.09);
    },
    /** A low thud for a touchdown. */
    thud() {
      tone(90, 0.25, 'sine', 0.22, 0);
      tone(55, 0.3, 'triangle', 0.14, 0.02);
    },
    /** A rising chime for a delivery. */
    deliver() {
      tone(659, 0.14, 'sine', 0.12, 0);
      tone(988, 0.14, 'sine', 0.12, 0.12);
      tone(1318, 0.22, 'sine', 0.1, 0.24);
    },
    /** A harsh burst for a crash. */
    crash() {
      tone(70, 0.5, 'sawtooth', 0.2, 0);
      tone(45, 0.7, 'square', 0.12, 0.05);
    },
  };
}
