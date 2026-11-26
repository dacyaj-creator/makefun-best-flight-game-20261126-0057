// Every tuning number, colour and place in one place. The world is a 24 km by 24 km
// stretch of Indonesian sea with four islands; the playfield the renderer draws is a
// fixed 1280x720 logical area scaled to the window, so no rule below depends on the
// screen size. All distances are metres, all speeds metres per second, all angles radians.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The logical playfield the renderer scales to the window. */
export const FIELD = { width: 1280, height: 720 };

/** The camera's field of view, in radians; the focal length follows from it. */
export const FOV = (68 * Math.PI) / 180;

/** The plane: a small turboprop mail plane with fixed gear. Speeds are m/s. */
export const PLANE = {
  /** Top speed at full throttle, clean. */
  maxSpeed: 95,
  /** Top speed at full throttle with flaps down. */
  maxSpeedFlaps: 68,
  /** Below this the wing stops flying and the plane sinks. */
  stallSpeed: 30,
  /** Stall speed with flaps down. */
  stallSpeedFlaps: 22,
  /** How fast speed chases the throttle's target speed, per second. */
  speedRate: 0.55,
  /** How fast pitch chases the stick, radians per second. */
  pitchRate: 1.4,
  /** How fast roll chases the stick, radians per second. */
  rollRate: 2.2,
  /** How fast pitch settles back to level with no input, radians per second. */
  pitchSettle: 0.45,
  /** How fast roll settles back to level with no input, radians per second. */
  rollSettle: 1.1,
  /** The steepest pitch the stick asks for. */
  maxPitch: 0.38,
  /** The steepest bank the stick asks for. */
  maxRoll: 0.62,
  /** The rudder's extra turn rate, radians per second. */
  rudderRate: 0.12,
  /** Fuel in the tanks at the start of a sortie, in percent. */
  fuel: 100,
  /** Fuel burned per second at full throttle; idle burns a quarter of that. The mail
   *  run is about 35 km, so the tank has to last roughly eleven minutes at cruise. */
  fuelBurn: 0.16,
  /** Damage taken on a hard landing. */
  hardLandingDamage: 25,
};

/** What a landing has to look like to count instead of a crash. */
export const LANDING = {
  /** The gentlest vertical speed that still counts as a touchdown, m/s (negative is down). */
  maxSink: -3.5,
  /** The steepest bank allowed at touchdown, radians. */
  maxRoll: 0.3,
  /** The slowest speed that still flies onto the runway. */
  minSpeed: 24,
  /** The fastest speed that still stops on the strip. */
  maxSpeed: 78,
};

/** The three islands with airstrips, and one small islet for the view. */
export const ISLANDS = [
  { name: 'Pulau Merpati', x: 0, z: 0, radius: 5200, peak: 880, volcano: { x: -1600, z: -1400, radius: 1400, peak: 420 } },
  { name: 'Pulau Kelapa', x: 8800, z: -6800, radius: 3600, peak: 640, volcano: null },
  { name: 'Pulau Cendana', x: -8200, z: 7800, radius: 3200, peak: 560, volcano: null },
  { name: 'Pulau Kecil', x: 6000, z: 7000, radius: 1200, peak: 180, volcano: null },
];

/** The strips: a rectangle in the world, named, with its heading in radians. Each one
 *  sits on its island's coast, where the ground is already low, so the approach over
 *  the sea is flat and the runway is not a crater in a mountain. */
export const STRIPS = [
  { name: 'Merpati', x: 4600, z: 900, halfLength: 700, halfWidth: 30, heading: Math.PI / 2 },
  { name: 'Kelapa', x: 8800, z: -3500, halfLength: 700, halfWidth: 30, heading: 0 },
  { name: 'Cendana', x: -6100, z: 5800, halfLength: 700, halfWidth: 30, heading: Math.PI / 2 },
];

/** The ring course: five rings around Pulau Merpati, in the order to fly them. */
export const RINGS = [
  { x: 2500, z: -2500, alt: 180, radius: 45 },
  { x: 3500, z: 2500, alt: 220, radius: 45 },
  { x: -500, z: 4200, alt: 200, radius: 45 },
  { x: -3800, z: 500, alt: 260, radius: 45 },
  { x: -500, z: -4200, alt: 180, radius: 45 },
];

/** The missions on the title screen, in the order they are shown. */
export const MISSIONS = [
  {
    id: 'cincin',
    key: '1',
    name: 'Lintasan Cincin',
    goal: 'Terbang melewati 5 cincin di sekitar Pulau Merpati.',
    detail: 'Setiap cincin 100 poin. Terbang cepat dan rapi — makin cepat selesai, makin besar bonusnya.',
  },
  {
    id: 'mendarat',
    key: '2',
    name: 'Mendarat di Merpati',
    goal: 'Lepas landas, putar satu sirkuit, lalu mendarat di landasan Merpati.',
    detail: 'Mendarat halus dihitung dari kecepatan turun, kemiringan, dan kecepatan saat menyentuh landasan.',
  },
  {
    id: 'pos',
    key: '3',
    name: 'Pos Nusantara',
    goal: 'Antar surat ke Kelapa dan Cendana, lalu pulang ke Merpati.',
    detail: 'Tiga kali mendarat, masing-masing 150 poin. Atur throttle: boros berarti kehabisan bahan bakar di tengah laut.',
  },
];

/** Points: a ring, a delivery, and the bonuses that follow them. */
export const SCORE = {
  ring: 100,
  delivery: 150,
  landing: 200,
  timeBonusPerSecond: 2,
  hardLandingPenalty: 50,
};

/** The warm tropical palette: one style for sky, sea, land and the aircraft. */
export const PALETTE = {
  skyTop: '#7ec8f2',
  skyHorizon: '#dceffb',
  sun: '#fff3c4',
  seaDeep: '#1d6f9e',
  seaShallow: '#3fa7c4',
  seaGlint: '#bfe9f2',
  sand: '#e8d39a',
  field: '#8fbf5a',
  rice: '#a8cf6e',
  forest: '#4f8f3a',
  jungle: '#2f6b2f',
  rock: '#8a7f72',
  volcano: '#b9b2a6',
  runway: '#3a3f46',
  runwayMark: '#f2f2e8',
  ring: '#ff7a1a',
  ringInner: '#ffffff',
  planeWhite: '#f4f1e6',
  planeOrange: '#e8641c',
  planeDark: '#2e3238',
  panel: 'rgba(16, 28, 40, 0.72)',
  panelEdge: 'rgba(255, 255, 255, 0.25)',
  text: '#f4f8fb',
  muted: '#b8c8d4',
  good: '#7ddc7d',
  warn: '#ffcf4d',
  bad: '#ff6b5e',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score per mission is kept between visits (this browser only). */
export const BEST_KEY = 'penerbangan-nusantara.best.';
