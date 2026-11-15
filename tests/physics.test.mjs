import assert from "node:assert/strict";
import { SpatialGrid, eraseLines, simplifyPolyline } from "../js/lines.js";
import { createSimulation, keelLength, REST_KEEL, stepSimulation, FIXED_DT } from "../js/physics.js";
import { parseTrack, serializeTrack } from "../js/storage.js";
import { sampleTracks } from "../js/tracks.js";

function run(lines, flag, seconds) {
  const grid = new SpatialGrid();
  grid.build(lines);
  const sim = createSimulation(flag);
  const steps = Math.round(seconds / FIXED_DT);
  let maxImpact = 0;
  for (let i = 0; i < steps; i++) {
    stepSimulation(sim, grid, FIXED_DT);
    if (sim.stepImpact > maxImpact) maxImpact = sim.stepImpact;
  }
  return { sim, maxImpact };
}

function flatFlag(y) {
  return { x: 120, y: y - 8, angle: 0 };
}

const flat = [{ type: "normal", points: [{ x: -200, y: 400 }, { x: 2200, y: 400 }] }];
const settled = run(flat, flatFlag(400), 2.2);
assert.equal(settled.sim.crashed, false, `flat line should not crash (impact ${settled.maxImpact.toFixed(1)})`);
assert.ok(settled.sim.sled[2].y < 400, `sled should stay above the line, y=${settled.sim.sled[2].y}`);
assert.ok(settled.sim.sled[2].y > 370, `sled should rest near the line, y=${settled.sim.sled[2].y}`);
assert.ok(Math.hypot(settled.sim.vx, settled.sim.vy) < 90, `flat sled should nearly stop, speed=${Math.hypot(settled.sim.vx, settled.sim.vy)}`);
assert.ok(Math.abs(keelLength(settled.sim) - REST_KEEL) < REST_KEEL * 0.12, "sled should keep its shape");

const slope = [{ type: "normal", points: [{ x: -100, y: 80 }, { x: 2400, y: 80 + 2500 * Math.tan(0.28) }] }];
const slid = run(slope, { x: 80, y: 80 - 6, angle: 0.28 }, 2);
assert.equal(slid.sim.crashed, false, `slope should not crash (impact ${slid.maxImpact.toFixed(1)})`);
assert.ok(slid.sim.sled[2].x > 350, `slope should carry the sled forward, x=${slid.sim.sled[2].x}`);
assert.ok(Math.hypot(slid.sim.vx, slid.sim.vy) > 280, `slope speed too low: ${Math.hypot(slid.sim.vx, slid.sim.vy).toFixed(1)}`);

const red = [{ type: "accel", points: [{ x: -100, y: 300 }, { x: 4000, y: 300 }] }];
const boosted = run(red, { x: 40, y: 292, angle: 0 }, 1.4);
assert.equal(boosted.sim.crashed, false, "red line should not crash");
assert.ok(Math.hypot(boosted.sim.vx, boosted.sim.vy) > 700, `red boost too weak: ${Math.hypot(boosted.sim.vx, boosted.sim.vy).toFixed(1)}`);

const wall = [
  { type: "normal", points: [{ x: 0, y: 120 }, { x: 700, y: 430 }] },
  { type: "normal", points: [{ x: 760, y: 80 }, { x: 760, y: 700 }] },
];
const crashed = run(wall, { x: 40, y: 100, angle: 0.42 }, 3);
assert.equal(crashed.sim.crashed, true, "a wall should throw the rider");

const scenery = [
  { type: "scenery", points: [{ x: -50, y: 240 }, { x: 800, y: 240 }] },
  { type: "normal", points: [{ x: -50, y: 320 }, { x: 800, y: 320 }] },
];
const through = run(scenery, { x: 80, y: 210, angle: 0 }, 1.6);
assert.equal(through.sim.crashed, false, "dropping onto a blue line should be survivable");
assert.ok(through.sim.sled[2].y > 300, `scenery should not catch the sled, y=${through.sim.sled[2].y}`);
assert.ok(through.sim.sled[2].y < 330, `blue line should catch the sled, y=${through.sim.sled[2].y}`);

const erased = eraseLines(
  [{ type: "normal", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }] }],
  [{ x: 100, y: 0 }],
  8,
);
assert.equal(erased.length, 2);
const simple = simplifyPolyline(
  [{ x: 0, y: 0 }, { x: 1, y: 0.01 }, { x: 2, y: 0 }, { x: 10, y: 4 }],
  0.5,
);
assert.ok(simple.length >= 2 && simple.length < 4);

const track = serializeTrack("测试", { x: 1, y: 2, angle: 0.2 }, scenery);
const parsed = parseTrack(track);
assert.equal(parsed.name, "测试");
assert.equal(parsed.lines.length, 2);
assert.equal(parsed.lines[0].type, "scenery");

for (const sample of sampleTracks()) {
  assert.ok(sample.lines.length >= 1, sample.name);
  const result = run(sample.lines, sample.flag, 6);
  const speed = Math.hypot(result.sim.vx, result.sim.vy);
  const moved = Math.hypot(result.sim.sled[2].x - sample.flag.x, result.sim.sled[2].y - sample.flag.y);
  console.log(
    `${sample.name}: crashed=${result.sim.crashed} reason=${result.sim.crashReason || ""} x=${result.sim.sled[2].x.toFixed(0)} y=${result.sim.sled[2].y.toFixed(0)} speed=${speed.toFixed(0)} moved=${moved.toFixed(0)} impact=${result.maxImpact.toFixed(0)}`,
  );
  assert.equal(result.sim.crashed, false, `${sample.name} should survive 6s (${result.sim.crashReason})`);
  assert.ok(moved > 80, `${sample.name} should move`);
}

console.log("physics tests passed");
