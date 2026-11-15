/** Verlet sled + stick rider. Mounted pose follows the sled; a hard hit releases the ragdoll. */

export const GRAVITY = 980;
export const FIXED_DT = 1 / 240;
export const COLLISION_RADIUS = 1.85;
export const CRASH_IMPACT = 540;

export const SLED_LOCAL = [
  { x: -42, y: 0 },
  { x: -22, y: 2.1 },
  { x: 0, y: 3.1 },
  { x: 22, y: 1.4 },
  { x: 44, y: -6.5 },
  { x: -6, y: -13 },
  { x: 20, y: -9 },
];

export const RIDER_LOCAL = [
  { x: -2, y: -26 },
  { x: 5, y: -44 },
  { x: 13, y: -60 },
  { x: 9, y: -42 },
  { x: 18, y: -28 },
  { x: 22, y: -14 },
  { x: 4, y: -12 },
  { x: 20, y: -2 },
  { x: -14, y: -13 },
  { x: 0, y: 0 },
];

const SLED_STICKS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [1, 5], [2, 5], [3, 5], [4, 5],
  [5, 6], [3, 6], [4, 6], [2, 6], [1, 6],
];

const RIDER_BONES = [
  [0, 1], [1, 2],
  [1, 3], [3, 4], [4, 5],
  [0, 6], [6, 7],
  [0, 8], [8, 9],
];

const SLED_MASS = [0.42, 0.4, 0.36, 0.4, 0.42, 0.32, 0.38];
const KEEL = [0, 1, 2, 3, 4, 5];
const RIDER_RADIUS = [3.4, 4.0, 5.6, 2.6, 2.4, 2.6, 2.5, 2.8, 2.5, 2.8];
const SCARF_N = 12;
const SCARF_LEN = 5.6;
const LOCAL_CHORD = Math.atan2(
  SLED_LOCAL[4].y - SLED_LOCAL[0].y,
  SLED_LOCAL[4].x - SLED_LOCAL[0].x,
);
const MID = SLED_LOCAL[2];

const BOOST = 860;
const MU_NORMAL = 0.04;
const MU_ACCEL = 0.012;

function makePoint(x, y, invMass) {
  return { x, y, px: x, py: y, invMass };
}

function transform(local, originX, originY, rot) {
  const lx = local.x - MID.x;
  const ly = local.y - MID.y;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    x: originX + lx * c - ly * s,
    y: originY + lx * s + ly * c,
  };
}

function stick(a, b, rest, stiffness) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const diff = (dist - rest) / dist;
  const invA = a.invMass;
  const invB = b.invMass;
  const inv = invA + invB;
  if (inv === 0) return;
  const k = (stiffness * diff) / inv;
  const ox = dx * k;
  const oy = dy * k;
  a.x += ox * invA;
  a.y += oy * invA;
  b.x -= ox * invB;
  b.y -= oy * invB;
}

function limitDistance(a, b, min, max) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  if (dist > max) stick(a, b, max, 1);
  else if (dist < min) stick(a, b, min, 1);
}

function integrate(p, dt, gravityScale, drag) {
  let vx = p.x - p.px;
  let vy = p.y - p.py;
  const damp = Math.exp(-drag * dt);
  vx *= damp;
  vy *= damp;
  vy += GRAVITY * gravityScale * dt * dt;
  const sp = Math.hypot(vx, vy);
  const maxD = 26;
  if (sp > maxD) {
    const s = maxD / sp;
    vx *= s;
    vy *= s;
  }
  const x = p.x;
  const y = p.y;
  p.x += vx;
  p.y += vy;
  p.px = x;
  p.py = y;
}

function shapeMatch(sim, amount) {
  const sled = sim.sled;
  const tail = sled[0];
  const nose = sled[4];
  const mid = sled[2];
  const chord = Math.atan2(nose.y - tail.y, nose.x - tail.x);
  const rot = chord - LOCAL_CHORD;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < sled.length; i++) {
    if (i === 2) continue;
    const lx = SLED_LOCAL[i].x - MID.x;
    const ly = SLED_LOCAL[i].y - MID.y;
    const tx = mid.x + lx * c - ly * s;
    const ty = mid.y + lx * s + ly * c;
    const p = sled[i];
    const dx = (tx - p.x) * amount;
    const dy = (ty - p.y) * amount;
    p.x += dx;
    p.y += dy;
    p.px += dx;
    p.py += dy;
  }
}

function closestPoint(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby || 1e-8;
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  const dx = px - qx;
  const dy = py - qy;
  return { qx, qy, dist: Math.hypot(dx, dy), t };
}

function segmentHitT(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d1x = x2 - x1;
  const d1y = y2 - y1;
  const d2x = x4 - x3;
  const d2y = y4 - y3;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-10) return null;
  const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / den;
  const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  return null;
}

function collidePoint(p, grid, dt, radius) {
  const oldX = p.x;
  const oldY = p.y;
  const velX = oldX - p.px;
  const velY = oldY - p.py;
  const segs = grid.query(p.px, p.py, p.x, p.y, radius + 6);
  let contacted = false;
  let impact = 0;
  let hitType = null;
  for (let pass = 0; pass < 2; pass++) {
    let best = null;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const len = Math.hypot(seg.bx - seg.ax, seg.by - seg.ay) || 1e-6;
      const lx = -(seg.by - seg.ay) / len;
      const ly = (seg.bx - seg.ax) / len;
      const tx = (seg.bx - seg.ax) / len;
      const ty = (seg.by - seg.ay) / len;
      const prevC = closestPoint(p.px, p.py, seg.ax, seg.ay, seg.bx, seg.by);
      let side = (p.px - prevC.qx) * lx + (p.py - prevC.qy) * ly;
      let nx;
      let ny;
      if (Math.abs(side) < 0.35 && prevC.dist < radius + 0.5) {
        if (ly > 0) {
          nx = -lx;
          ny = -ly;
        } else {
          nx = lx;
          ny = ly;
        }
      } else if (side >= 0) {
        nx = lx;
        ny = ly;
      } else {
        nx = -lx;
        ny = -ly;
      }

      const swept = segmentHitT(p.px, p.py, p.x, p.y, seg.ax, seg.ay, seg.bx, seg.by);
      const now = closestPoint(p.x, p.y, seg.ax, seg.ay, seg.bx, seg.by);
      let cand = null;
      if (swept !== null) {
        const ix = p.px + (p.x - p.px) * swept;
        const iy = p.py + (p.y - p.py) * swept;
        const cc = closestPoint(ix, iy, seg.ax, seg.ay, seg.bx, seg.by);
        if (cc.dist <= radius + 0.8) {
          cand = { qx: cc.qx, qy: cc.qy, nx, ny, tx, ty, pen: radius + 1, type: seg.type, swept: true };
        }
      }
      if (!cand && now.dist < radius) {
        cand = {
          qx: now.qx,
          qy: now.qy,
          nx,
          ny,
          tx,
          ty,
          pen: radius - now.dist,
          type: seg.type,
          swept: false,
        };
      }
      if (cand && (!best || cand.pen > best.pen)) best = cand;
    }
    if (!best) break;

    let cx = best.qx + best.nx * radius - p.x;
    let cy = best.qy + best.ny * radius - p.y;
    const corr = Math.hypot(cx, cy);
    if (corr > 24) {
      const s = 24 / corr;
      cx *= s;
      cy *= s;
    }
    p.x += cx;
    p.y += cy;

    const vn = velX * best.nx + velY * best.ny;
    const vt = velX * best.tx + velY * best.ty;
    if (vn < 0) {
      const hit = -vn / dt;
      if (hit > impact) impact = hit;
    }
    const speedT = vt / dt;
    const mu = best.type === "accel" ? MU_ACCEL : MU_NORMAL;
    const coulomb = mu * GRAVITY * dt;
    let newSpeed = speedT - clamp(speedT, -coulomb, coulomb);
    if (best.type === "accel") {
      let dir;
      if (Math.abs(speedT) > 35) dir = Math.sign(speedT);
      else if (Math.abs(best.ty) > 0.08) dir = best.ty > 0 ? 1 : -1;
      else dir = Math.sign(speedT) || 1;
      newSpeed += dir * BOOST * dt;
    }
    const vtx = best.tx * newSpeed * dt;
    const vty = best.ty * newSpeed * dt;
    p.px = p.x - vtx;
    p.py = p.y - vty;
    contacted = true;
    hitType = best.type;
  }
  return { contacted, impact, type: hitType };
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function solveSled(sim) {
  const sled = sim.sled;
  for (let i = 0; i < SLED_STICKS.length; i++) {
    const [a, b] = SLED_STICKS[i];
    stick(sled[a], sled[b], sim.sledRest[i], 1);
  }
}

function collideSled(sim, grid, dt) {
  let contact = false;
  let impact = 0;
  let accel = false;
  for (let i = 0; i < KEEL.length; i++) {
    const hit = collidePoint(sim.sled[KEEL[i]], grid, dt, COLLISION_RADIUS);
    if (hit.contacted) contact = true;
    if (hit.impact > impact) impact = hit.impact;
    if (hit.type === "accel") accel = true;
  }
  return { contact, impact, accel };
}

function updateChord(sim, dt) {
  const sled = sim.sled;
  const chord = Math.atan2(sled[4].y - sled[0].y, sled[4].x - sled[0].x);
  let d = chord - sim.chord;
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  sim.omega = d / dt;
  sim.chord = chord;
  sim.angle = chord - LOCAL_CHORD;
}

function syncRider(sim, dt) {
  const sled = sim.sled;
  const mid = sled[2];
  const rot = sim.angle;
  const mvx = (mid.x - mid.px) / dt;
  const mvy = (mid.y - mid.py) / dt;
  const w = sim.omega;
  for (let i = 0; i < RIDER_LOCAL.length; i++) {
    const pos = transform(RIDER_LOCAL[i], mid.x, mid.y, rot);
    const rx = pos.x - mid.x;
    const ry = pos.y - mid.y;
    const pvx = mvx - w * ry;
    const pvy = mvy + w * rx;
    const p = sim.rider[i];
    p.x = pos.x;
    p.y = pos.y;
    p.px = pos.x - pvx * dt;
    p.py = pos.y - pvy * dt;
  }
}

function solveRagdoll(sim) {
  const rider = sim.rider;
  for (let i = 0; i < sim.riderBones.length; i++) {
    const bone = sim.riderBones[i];
    stick(rider[bone.a], rider[bone.b], bone.rest, 1);
  }
  for (let i = 0; i < sim.limits.length; i++) {
    const lim = sim.limits[i];
    limitDistance(rider[lim.a], rider[lim.b], lim.min, lim.max);
  }
}

function collideRider(sim, grid, dt) {
  for (let i = 0; i < sim.rider.length; i++) {
    collidePoint(sim.rider[i], grid, dt, RIDER_RADIUS[i]);
  }
}

function neckOf(sim) {
  const c = sim.rider[1];
  const h = sim.rider[2];
  return { x: c.x + (h.x - c.x) * 0.58, y: c.y + (h.y - c.y) * 0.58 };
}

function initScarf(sim) {
  const neck = neckOf(sim);
  const bx = -Math.cos(sim.angle);
  const by = -Math.sin(sim.angle);
  sim.scarf = [];
  for (let i = 0; i < SCARF_N; i++) {
    const x = neck.x + bx * i * SCARF_LEN;
    const y = neck.y + by * i * SCARF_LEN * 0.35 + i * 0.8;
    sim.scarf.push(makePoint(x, y, 1));
  }
}

export function stepScarf(sim, dt) {
  const scarf = sim.scarf;
  const neck = neckOf(sim);
  const root = scarf[0];
  root.x = neck.x;
  root.y = neck.y;
  const breeze = 70;
  const fx = -Math.cos(sim.angle) * breeze;
  const fy = -Math.sin(sim.angle) * breeze + 40;
  for (let i = 1; i < scarf.length; i++) {
    integrate(scarf[i], dt, 0.28, 2.6);
    scarf[i].x += fx * dt * dt;
    scarf[i].y += fy * dt * dt;
  }
  for (let n = 0; n < 8; n++) {
    scarf[0].x = neck.x;
    scarf[0].y = neck.y;
    scarf[0].px = neck.x;
    scarf[0].py = neck.y;
    for (let i = 0; i < scarf.length - 1; i++) {
      stick(scarf[i], scarf[i + 1], SCARF_LEN, 1);
    }
  }
  const pxn = -Math.sin(sim.angle);
  const pyn = Math.cos(sim.angle);
  for (let i = 2; i < scarf.length; i++) {
    const wave = Math.sin(sim.time * 6.5 + i * 0.85) * (i / scarf.length) * 6;
    scarf[i].x += pxn * wave;
    scarf[i].y += pyn * wave;
    scarf[i].px += pxn * wave;
    scarf[i].py += pyn * wave;
  }
}

function spawnSnow(sim, x, y, vx, vy) {
  if (sim.particles.length > 56) sim.particles.shift();
  sim.particles.push({
    x,
    y,
    vx: vx * 0.15 + (Math.random() - 0.5) * 70,
    vy: vy * 0.05 - 40 - Math.random() * 30,
    age: 0,
    life: 0.35 + Math.random() * 0.25,
    r: 1.1 + Math.random() * 1.3,
  });
}

function stepParticles(sim, dt) {
  const list = sim.particles;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.vy += 520 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.age += dt;
    if (p.age >= p.life) list.splice(i, 1);
  }
}

function measureSpeed(sim, dt) {
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < 5; i++) {
    vx += (sim.sled[i].x - sim.sled[i].px) / dt;
    vy += (sim.sled[i].y - sim.sled[i].py) / dt;
  }
  sim.vx = vx / 5;
  sim.vy = vy / 5;
}

function shouldCrash(sim) {
  if (sim.age < 0.28) return false;
  if (!sim.contact) return false;
  if (sim.stepImpact > CRASH_IMPACT) {
    sim.crashReason = "impact";
    return true;
  }
  if (Math.abs(sim.omega) > 8.2 && sim.stepImpact > 220) {
    sim.crashReason = "spin";
    return true;
  }
  const upy = sim.sled[5].y - sim.sled[2].y;
  if (upy > 4) {
    sim.crashReason = "flip";
    return true;
  }
  return false;
}

export function createSimulation(flag) {
  const riderBones = RIDER_BONES.map(([a, b]) => {
    const pa = RIDER_LOCAL[a];
    const pb = RIDER_LOCAL[b];
    return { a, b, rest: Math.hypot(pb.x - pa.x, pb.y - pa.y) };
  });
  const limits = [
    { a: 0, b: 2, min: 0.78, max: 1.04 },
    { a: 0, b: 7, min: 0.42, max: 1.08 },
    { a: 0, b: 9, min: 0.42, max: 1.08 },
    { a: 1, b: 5, min: 0.35, max: 1.12 },
    { a: 3, b: 5, min: 0.4, max: 1.15 },
  ].map((lim) => {
    const pa = RIDER_LOCAL[lim.a];
    const pb = RIDER_LOCAL[lim.b];
    const rest = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    return { a: lim.a, b: lim.b, min: rest * lim.min, max: rest * lim.max };
  });
  const sim = {
    sled: [],
    rider: [],
    scarf: [],
    sledRest: SLED_STICKS.map(([a, b]) => {
      const pa = SLED_LOCAL[a];
      const pb = SLED_LOCAL[b];
      return Math.hypot(pb.x - pa.x, pb.y - pa.y);
    }),
    riderBones,
    limits,
    crashed: false,
    crashTime: 0,
    age: 0,
    time: 0,
    contact: false,
    stepImpact: 0,
    onAccel: false,
    omega: 0,
    chord: 0,
    angle: flag.angle || 0,
    vx: 0,
    vy: 0,
    prevVx: 0,
    prevVy: 0,
    particles: [],
  };
  for (let i = 0; i < SLED_LOCAL.length; i++) sim.sled.push(makePoint(0, 0, SLED_MASS[i]));
  for (let i = 0; i < RIDER_LOCAL.length; i++) sim.rider.push(makePoint(0, 0, 1));
  applyFlag(sim, flag);
  return sim;
}

export function applyFlag(sim, flag) {
  const rot = flag.angle || 0;
  for (let i = 0; i < SLED_LOCAL.length; i++) {
    const pos = transform(SLED_LOCAL[i], flag.x, flag.y, rot);
    const p = sim.sled[i];
    p.x = p.px = pos.x;
    p.y = p.py = pos.y;
  }
  sim.angle = rot;
  sim.chord = Math.atan2(sim.sled[4].y - sim.sled[0].y, sim.sled[4].x - sim.sled[0].x);
  sim.omega = 0;
  sim.vx = 0;
  sim.vy = 0;
  sim.prevVx = 0;
  sim.prevVy = 0;
  sim.crashed = false;
  sim.crashTime = 0;
  sim.age = 0;
  sim.time = 0;
  sim.contact = false;
  sim.stepImpact = 0;
  sim.onAccel = false;
  sim.particles.length = 0;
  for (let i = 0; i < RIDER_LOCAL.length; i++) {
    const pos = transform(RIDER_LOCAL[i], flag.x, flag.y, rot);
    const p = sim.rider[i];
    p.x = p.px = pos.x;
    p.y = p.py = pos.y;
  }
  initScarf(sim);
}

export function stepSimulation(sim, grid, dt) {
  sim.age += dt;
  sim.time += dt;
  sim.stepImpact = 0;
  sim.contact = false;
  sim.onAccel = false;

  for (let i = 0; i < sim.sled.length; i++) integrate(sim.sled[i], dt, 1, 0.045);
  if (sim.crashed) {
    for (let i = 0; i < sim.rider.length; i++) integrate(sim.rider[i], dt, 1, 0.18);
  }

  for (let iter = 0; iter < 8; iter++) {
    solveSled(sim);
    shapeMatch(sim, 0.5);
    const hit = collideSled(sim, grid, dt);
    if (hit.contact) sim.contact = true;
    if (hit.impact > sim.stepImpact) sim.stepImpact = hit.impact;
    if (hit.accel) sim.onAccel = true;
  }
  solveSled(sim);
  const hit = collideSled(sim, grid, dt);
  if (hit.contact) sim.contact = true;
  if (hit.impact > sim.stepImpact) sim.stepImpact = hit.impact;
  if (hit.accel) sim.onAccel = true;

  updateChord(sim, dt);
  measureSpeed(sim, dt);
  const speedNow = Math.hypot(sim.vx, sim.vy);
  if (sim.contact && speedNow < 36 && sim.stepImpact < 80) {
    const dot = sim.vx * sim.prevVx + sim.vy * sim.prevVy;
    if (dot < 0) {
      for (let i = 0; i < sim.sled.length; i++) {
        const p = sim.sled[i];
        p.px += (p.x - p.px) * 0.45;
        p.py += (p.y - p.py) * 0.45;
      }
      measureSpeed(sim, dt);
    }
  }
  sim.prevVx = sim.vx;
  sim.prevVy = sim.vy;

  if (!sim.crashed) {
    if (shouldCrash(sim)) {
      sim.crashed = true;
      sim.crashTime = sim.time;
    } else {
      syncRider(sim, dt);
    }
  } else {
    for (let iter = 0; iter < 6; iter++) {
      solveRagdoll(sim);
      collideRider(sim, grid, dt);
    }
  }

  stepScarf(sim, dt);

  if (sim.contact && Math.hypot(sim.vx, sim.vy) > 240 && Math.random() < 0.18) {
    const mid = sim.sled[2];
    spawnSnow(sim, mid.x, mid.y + 2, sim.vx, sim.vy);
  }
  stepParticles(sim, dt);
}

export function keelLength(sim) {
  return Math.hypot(sim.sled[4].x - sim.sled[0].x, sim.sled[4].y - sim.sled[0].y);
}

export const REST_KEEL = Math.hypot(
  SLED_LOCAL[4].x - SLED_LOCAL[0].x,
  SLED_LOCAL[4].y - SLED_LOCAL[0].y,
);
