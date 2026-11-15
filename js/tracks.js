/** Built-in sample tracks. Coordinates are world pixels, y grows downward. */

function span(type, x0, x1, step, fn) {
  const points = [];
  const dir = x1 >= x0 ? 1 : -1;
  const n = Math.ceil(Math.abs(x1 - x0) / step);
  for (let i = 0; i <= n; i++) {
    const x = x0 + dir * Math.min(Math.abs(x1 - x0), i * step);
    const y = fn(x);
    points.push({ x, y });
  }
  return { type, points };
}

function pine(x, groundY, h) {
  const g = groundY - 8;
  return [
    {
      type: "scenery",
      points: [
        { x: x - h * 0.38, y: g },
        { x, y: g - h },
        { x: x + h * 0.38, y: g },
      ],
    },
    {
      type: "scenery",
      points: [
        { x: x - h * 0.24, y: g - h * 0.42 },
        { x, y: g - h * 1.05 },
        { x: x + h * 0.24, y: g - h * 0.42 },
      ],
    },
    {
      type: "scenery",
      points: [
        { x, y: g + 6 },
        { x, y: g - h * 0.36 },
      ],
    },
  ];
}

function slopeAt(fn, x) {
  const e = 4;
  return Math.atan2(fn(x + e) - fn(x - e), e * 2);
}

function flagOn(fn, x, lift = 3.4) {
  const angle = slopeAt(fn, x);
  return {
    x: x + Math.sin(angle) * lift,
    y: fn(x) - Math.cos(angle) * lift,
    angle,
  };
}

function snowY(x) {
  return 340 + x * 0.16 + Math.sin(x * 0.007) * 8;
}

function buildSnow() {
  const lip = 1180;
  const land = 1340;
  const landY0 = snowY(lip) + 78;
  const ease = (x) => {
    const t = Math.max(0, x - land);
    return landY0 + 160 * (1 - Math.exp(-t / 380)) + t * 0.05;
  };
  const lines = [
    span("normal", -80, lip, 12, snowY),
    span("normal", land, 2100, 12, ease),
    span("accel", 2100, 5200, 12, (x) => ease(2100) + (x - 2100) * (0.42 * Math.exp(-(2100 - land) / 380) + 0.05)),
  ];
  const grounds = [260, 520, 860, 1500, 1980, 2600];
  for (const x of grounds) {
    const y = x <= lip ? snowY(x) : x < land ? ease(land) : ease(Math.min(x, 2100));
    lines.push(...pine(x, y + 2, 50 + ((x * 13) % 16)));
  }
  lines.push({
    type: "scenery",
    points: [
      { x: 80, y: 180 },
      { x: 150, y: 160 },
      { x: 230, y: 188 },
    ],
  });
  lines.push({
    type: "scenery",
    points: [
      { x: 1880, y: 220 },
      { x: 1960, y: 196 },
      { x: 2050, y: 230 },
    ],
  });
  return {
    id: "snow",
    name: "缓坡初雪",
    flag: flagOn(snowY, 60, 3.6),
    lines,
  };
}

function valleyY(x) {
  return 700 - (x * x) / 560;
}

function buildValley() {
  const lines = [span("normal", -520, 520, 10, valleyY)];
  lines.push(
    span("scenery", -620, 620, 28, (x) => 120 + Math.sin(x * 0.01) * 16),
  );
  for (const x of [-360, -160, 160, 360]) {
    lines.push(...pine(x, valleyY(x) + 4, 46));
  }
  const startX = -360;
  return {
    id: "valley",
    name: "月牙冰谷",
    flag: flagOn(valleyY, startX, 3.8),
    lines,
  };
}

function flameApproach(x) {
  return 210 + x * 0.34 + Math.sin(x * 0.012) * 6;
}

function buildFlame() {
  const lipX = 640;
  const landX = 760;
  const course = (x) => 600 + (x - 860) * 0.82;
  const lines = [
    span("normal", -20, lipX, 12, flameApproach),
    span("normal", landX, 1120, 12, course),
    span("accel", 1120, 4200, 12, course),
  ];
  lines.push({
    type: "scenery",
    points: [
      { x: 120, y: 56 },
      { x: 250, y: 36 },
      { x: 390, y: 64 },
    ],
  });
  lines.push(...pine(220, flameApproach(220) + 2, 48));
  lines.push(...pine(landX + 700, course(landX + 700) + 3, 46));
  lines.push(...pine(landX + 1600, course(landX + 1600) + 3, 54));
  return {
    id: "flame",
    name: "赤焰飞跃",
    flag: flagOn(flameApproach, 24, 3.6),
    lines,
  };
}

let cache = null;

export function sampleTracks() {
  if (!cache) cache = [buildSnow(), buildValley(), buildFlame()];
  return cache;
}

export function sampleById(id) {
  return sampleTracks().find((track) => track.id === id) || null;
}
