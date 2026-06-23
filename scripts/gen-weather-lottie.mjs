// Generates lightweight, valid, looping Lottie animations for the Ground
// screen weather background — one JSON per condition in assets/weather/.
//
// These are intentionally simple, low-key motion backdrops (drifting
// clouds, falling rain, a pulsing sun, twinkling stars). They're meant to
// sit at low opacity behind content and can be swapped for richer designer
// assets later without touching any wiring — the filenames are the
// contract (see utils/weatherLottie.ts).
//
// Run: node scripts/gen-weather-lottie.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'weather');

const W = 400;
const H = 800;
const FR = 30;
const OP = 120; // 4s loop

const rgb = (r, g, b) => [r / 255, g / 255, b / 255];

// Linear ease — keeps continuous motion (rain/clouds) seamless across the
// loop boundary.
const LIN_I = { x: [0.5], y: [0.5] };
const LIN_O = { x: [0.5], y: [0.5] };

function fill(color, opacity = 100) {
  return { ty: 'fl', c: { a: 0, k: color }, o: { a: 0, k: opacity }, r: 1, bm: 0 };
}

function ellipse(w, h) {
  return { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [w, h] } };
}

function rect(w, h, round = 0) {
  return { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [w, h] }, r: { a: 0, k: round } };
}

// A group with a single drawn shape + fill, positioned at [x,y].
function group(shape, color, x, y, opacity = 100) {
  return {
    ty: 'gr',
    it: [
      shape,
      fill(color, opacity),
      {
        ty: 'tr',
        p: { a: 0, k: [x, y] },
        a: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 },
      },
    ],
    nm: 'g',
    bm: 0,
  };
}

// Layer scaffold. Pass keyframed ks fields to animate.
let indCounter = 1;
function layer(shapes, ks = {}) {
  return {
    ddd: 0,
    ind: indCounter++,
    ty: 4,
    nm: 'l',
    sr: 1,
    ks: {
      o: ks.o || { a: 0, k: 100 },
      r: ks.r || { a: 0, k: 0 },
      p: ks.p || { a: 0, k: [W / 2, H / 2, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: ks.s || { a: 0, k: [100, 100, 100] },
    },
    ao: 0,
    shapes,
    ip: 0,
    op: OP,
    st: 0,
    bm: 0,
  };
}

function posKeys(points) {
  // points: [{t, v:[x,y]}] -> position keyframes (linear)
  return {
    a: 1,
    k: points.map((p, i) => ({
      t: p.t,
      s: [p.v[0], p.v[1], 0],
      ...(i < points.length - 1 ? { i: LIN_I, o: LIN_O } : {}),
    })),
  };
}

function opacityKeys(points) {
  return {
    a: 1,
    k: points.map((p, i) => ({
      t: p.t,
      s: [p.v],
      ...(i < points.length - 1 ? { i: { x: [0.5], y: [0.5] }, o: { x: [0.5], y: [0.5] } } : {}),
    })),
  };
}

function scaleKeys(points) {
  return {
    a: 1,
    k: points.map((p, i) => ({
      t: p.t,
      s: [p.v, p.v, 100],
      ...(i < points.length - 1 ? { i: { x: [0.5], y: [0.5] }, o: { x: [0.5], y: [0.5] } } : {}),
    })),
  };
}

function comp(nm, layers) {
  return { v: '5.7.4', fr: FR, ip: 0, op: OP, w: W, h: H, nm, ddd: 0, assets: [], layers };
}

// Full-screen background tint layer.
function bg(color) {
  return layer([group(rect(W, H), color, 0, 0)], { p: { a: 0, k: [W / 2, H / 2, 0] } });
}

// A falling drop streak that travels top -> bottom, staggered by phase.
function drop(color, x, phase, len = 26, speedRows = 1) {
  const span = OP / speedRows;
  const start = -phase;
  const pts = [];
  // Two cycles so a single drop keeps falling across the loop.
  for (let c = 0; c <= speedRows + 1; c++) {
    pts.push({ t: Math.round(start + c * span), v: [x, -40 + ((c * (H + 80)) % (H + 80)) - (H + 80) * 0] });
  }
  // Simpler: linear travel from -40 to H+40 across the loop, offset by phase.
  return layer([group(rect(3, len, 1.5), color, 0, 0)], {
    p: posKeys([
      { t: 0, v: [x, -40 - phase] },
      { t: OP, v: [x, H + 40 - phase] },
    ]),
  });
}

// A drifting cloud (soft stacked ellipses) moving left->right.
function cloud(color, y, scale, phase, opacity = 100) {
  const shapes = [
    group(ellipse(120 * scale, 70 * scale), color, 0, 0, opacity),
    group(ellipse(90 * scale, 56 * scale), color, -70 * scale, 10 * scale, opacity),
    group(ellipse(90 * scale, 56 * scale), color, 70 * scale, 10 * scale, opacity),
  ];
  return layer(shapes, {
    p: posKeys([
      { t: 0, v: [-160 + phase, y] },
      { t: OP, v: [W + 160 + phase, y] },
    ]),
  });
}

// A twinkling star (opacity oscillation).
function star(color, x, y, r, phase) {
  return layer([group(ellipse(r, r), color, 0, 0)], {
    p: { a: 0, k: [x, y, 0] },
    o: opacityKeys([
      { t: 0, v: 20 },
      { t: (OP / 3 + phase) % OP, v: 90 },
      { t: ((2 * OP) / 3 + phase) % OP, v: 30 },
      { t: OP, v: 20 },
    ]),
  });
}

// A pulsing sun disc.
function sun(color, x, y, baseScale) {
  return layer([group(ellipse(140, 140), color, 0, 0, 90)], {
    p: { a: 0, k: [x, y, 0] },
    s: scaleKeys([
      { t: 0, v: baseScale },
      { t: OP / 2, v: baseScale + 8 },
      { t: OP, v: baseScale },
    ]),
  });
}

// A horizontal fog band drifting.
function fogBand(color, y, h, phase, opacity) {
  return layer([group(rect(W * 1.6, h, h / 2), color, 0, 0, opacity)], {
    p: posKeys([
      { t: 0, v: [W / 2 - 60 + phase, y] },
      { t: OP / 2, v: [W / 2 + 60 + phase, y] },
      { t: OP, v: [W / 2 - 60 + phase, y] },
    ]),
  });
}

// A lightning flash overlay (brief opacity spikes).
function flash(color) {
  return layer([group(rect(W, H), color, 0, 0)], {
    p: { a: 0, k: [W / 2, H / 2, 0] },
    o: opacityKeys([
      { t: 0, v: 0 },
      { t: 30, v: 0 },
      { t: 33, v: 55 },
      { t: 37, v: 0 },
      { t: 41, v: 40 },
      { t: 45, v: 0 },
      { t: OP, v: 0 },
    ]),
  });
}

function build(nm, buildLayers) {
  indCounter = 1;
  const layers = buildLayers();
  return comp(nm, layers);
}

const DROP_COLOR = rgb(150, 180, 220);
const CLOUD_GREY = rgb(70, 74, 82);
const CLOUD_LIGHT = rgb(120, 126, 136);

const FILES = {
  'clear-day': () => [
    bg(rgb(28, 40, 64)),
    sun(rgb(214, 158, 48), W / 2, 220, 100),
  ],
  'clear-night': () => [
    bg(rgb(12, 16, 30)),
    layer([group(ellipse(110, 110), rgb(200, 205, 220), 0, 0, 80)], { p: { a: 0, k: [W / 2 + 70, 200, 0] } }),
    star(rgb(220, 224, 235), 80, 140, 5, 0),
    star(rgb(220, 224, 235), 300, 100, 4, 20),
    star(rgb(220, 224, 235), 180, 260, 6, 45),
    star(rgb(220, 224, 235), 330, 320, 4, 70),
    star(rgb(220, 224, 235), 60, 360, 5, 90),
  ],
  'partly-cloudy': () => [
    bg(rgb(34, 46, 68)),
    sun(rgb(214, 158, 48), W / 2 + 80, 180, 80),
    cloud(CLOUD_LIGHT, 240, 1.0, 0, 95),
    cloud(CLOUD_LIGHT, 420, 0.7, 120, 80),
  ],
  cloudy: () => [
    bg(rgb(40, 44, 52)),
    cloud(CLOUD_GREY, 180, 1.1, 0, 100),
    cloud(CLOUD_GREY, 320, 0.9, 90, 90),
    cloud(CLOUD_LIGHT, 460, 0.75, 180, 75),
  ],
  rain: () => {
    const layers = [bg(rgb(34, 40, 52)), cloud(CLOUD_GREY, 150, 1.0, 0, 90)];
    const xs = [40, 90, 150, 210, 260, 310, 360];
    xs.forEach((x, i) => layers.push(drop(DROP_COLOR, x, (i * OP) / xs.length, 22)));
    return layers;
  },
  'heavy-rain': () => {
    const layers = [bg(rgb(26, 30, 42)), cloud(CLOUD_GREY, 140, 1.1, 0, 95)];
    const xs = [20, 55, 90, 125, 160, 195, 230, 265, 300, 335, 370];
    xs.forEach((x, i) => layers.push(drop(DROP_COLOR, x, (i * OP) / xs.length, 30)));
    return layers;
  },
  storm: () => {
    const layers = [bg(rgb(20, 22, 32)), flash(rgb(230, 232, 245)), cloud(rgb(48, 50, 60), 150, 1.2, 0, 100)];
    const xs = [30, 80, 130, 180, 230, 280, 330, 380];
    xs.forEach((x, i) => layers.push(drop(DROP_COLOR, x, (i * OP) / xs.length, 34)));
    return layers;
  },
  fog: () => [
    bg(rgb(46, 50, 58)),
    fogBand(rgb(150, 154, 162), 220, 70, 0, 28),
    fogBand(rgb(170, 174, 182), 340, 90, 40, 22),
    fogBand(rgb(150, 154, 162), 460, 80, 80, 26),
    fogBand(rgb(180, 184, 192), 580, 100, 20, 18),
  ],
  sunrise: () => [
    bg(rgb(58, 44, 56)),
    layer([group(rect(W, 320, 0), rgb(196, 122, 64), 0, 0, 45)], { p: { a: 0, k: [W / 2, H - 120, 0] } }),
    layer([group(ellipse(150, 150), rgb(226, 168, 84), 0, 0, 95)], {
      p: posKeys([
        { t: 0, v: [W / 2, H - 80] },
        { t: OP, v: [W / 2, H - 220] },
      ]),
    }),
  ],
};

mkdirSync(OUT_DIR, { recursive: true });
let count = 0;
for (const [name, fn] of Object.entries(FILES)) {
  const json = build(name, fn);
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(json));
  count++;
}
console.log(`Wrote ${count} weather Lottie files to assets/weather/`);
