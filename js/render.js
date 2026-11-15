/** World-space vector drawing. The caller sets a DPR transform first. */

export const PAPER = "#f3f5f8";

const COLORS = {
  normal: "#2a62e8",
  accel: "#e42323",
  scenery: "#1c9a52",
};

const FONT = '"WenQuanYi Micro Hei","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';

export function flagGeometry(flag) {
  const a = flag.angle || 0;
  const base = {
    x: flag.x - Math.cos(a) * 50,
    y: flag.y - Math.sin(a) * 50,
  };
  return {
    anchor: { x: flag.x, y: flag.y },
    handle: {
      x: flag.x + Math.cos(a) * 58,
      y: flag.y + Math.sin(a) * 58,
    },
    poleBase: base,
    poleTop: { x: base.x, y: base.y - 56 },
  };
}

function viewBounds(camera, viewW, viewH, margin) {
  const hw = viewW / 2 / camera.zoom + margin;
  const hh = viewH / 2 / camera.zoom + margin;
  return {
    x0: camera.x - hw,
    y0: camera.y - hh,
    x1: camera.x + hw,
    y1: camera.y + hh,
  };
}

function cull(points, bounds) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX >= bounds.x0 && minX <= bounds.x1 && maxY >= bounds.y0 && minY <= bounds.y1;
}

function tracePolyline(ctx, points) {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
}

function drawGrid(ctx, camera, viewW, viewH) {
  const bounds = viewBounds(camera, viewW, viewH, 40);
  let step = 80;
  while (step * camera.zoom < 22) step *= 2;
  const x0 = Math.floor(bounds.x0 / step) * step;
  const y0 = Math.floor(bounds.y0 / step) * step;
  const r = Math.max(1.1, 1.2 / camera.zoom);
  ctx.fillStyle = "rgba(36, 52, 74, 0.05)";
  ctx.beginPath();
  for (let x = x0; x <= bounds.x1; x += step) {
    for (let y = y0; y <= bounds.y1; y += step) {
      ctx.rect(x, y, r, r);
    }
  }
  ctx.fill();
}

function drawLinesOfType(ctx, lines, type, bounds, camera) {
  ctx.beginPath();
  let any = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type !== type || line.points.length < 2) continue;
    if (!cull(line.points, bounds)) continue;
    tracePolyline(ctx, line.points);
    any = true;
  }
  if (!any) return;
  const width = Math.max(2.2, 1.15 / camera.zoom);
  if (type === "accel") {
    ctx.strokeStyle = "rgba(228, 35, 35, 0.22)";
    ctx.lineWidth = width + 4.2 / camera.zoom;
    ctx.stroke();
  }
  ctx.strokeStyle = COLORS[type];
  ctx.lineWidth = type === "scenery" ? width * 0.92 : width;
  ctx.stroke();
}

function drawPreview(ctx, preview, camera) {
  if (!preview || preview.points.length < 1) return;
  ctx.beginPath();
  tracePolyline(ctx, preview.points.length === 1 ? [preview.points[0], preview.points[0]] : preview.points);
  ctx.strokeStyle = COLORS[preview.type] || COLORS.normal;
  ctx.lineWidth = Math.max(2.2, 1.15 / camera.zoom);
  ctx.setLineDash([8 / camera.zoom, 6 / camera.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawActor(ctx, actor, alpha) {
  const sled = actor.sled;
  const rider = actor.rider;
  const angle = actor.angle || 0;
  ctx.save();
  if (alpha != null) ctx.globalAlpha = alpha;

  if (actor.scarf && alpha == null) drawScarf(ctx, actor.scarf);

  drawSled(ctx, sled);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#3c4048";
  ctx.lineWidth = 2.05;
  strokeChain(ctx, [rider[0], rider[8], rider[9]]);

  ctx.strokeStyle = "#16181c";
  ctx.lineWidth = 2.45;
  strokeChain(ctx, [rider[0], rider[6], rider[7]]);
  const neck = inset(rider[1], rider[2], 7.15);
  strokeChain(ctx, [rider[0], rider[1], neck]);
  strokeChain(ctx, [rider[1], rider[3], rider[4], rider[5]]);

  drawBoot(ctx, rider[9], angle, "#2a2d33");
  drawBoot(ctx, rider[7], angle, "#14161a");

  ctx.beginPath();
  ctx.fillStyle = "#16181c";
  ctx.arc(rider[2].x, rider[2].y, 7.15, 0, Math.PI * 2);
  ctx.fill();

  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  ctx.strokeStyle = "#f4f7fb";
  ctx.lineWidth = 1.35;
  ctx.beginPath();
  ctx.arc(rider[2].x + fx * 2.4, rider[2].y + fy * 2.4, 2.7, angle - 1.15, angle + 1.15);
  ctx.stroke();

  ctx.strokeStyle = "#16181c";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const hx = rider[2].x - fx * 5.2;
  const hy = rider[2].y - fy * 5.2;
  ctx.moveTo(hx, hy);
  ctx.quadraticCurveTo(hx - fx * 4 - fy * 3, hy - fy * 4 + fx * 3, hx - fx * 1.5 + fy * 2, hy - fy * 1.5 - fx * 2);
  ctx.stroke();

  ctx.restore();
}

function drawScarf(ctx, scarf) {
  ctx.lineCap = "round";
  for (let i = 0; i < scarf.length - 1; i++) {
    const t = i / (scarf.length - 1);
    ctx.beginPath();
    ctx.moveTo(scarf[i].x, scarf[i].y);
    ctx.lineTo(scarf[i + 1].x, scarf[i + 1].y);
    ctx.strokeStyle = `rgba(215, 38, 61, ${0.95 - t * 0.45})`;
    ctx.lineWidth = 3.15 * (1 - t) + 0.55;
    ctx.stroke();
  }
}

function drawSled(ctx, sled) {
  const keel = [sled[0], sled[1], sled[2], sled[3], sled[4]];
  const upx = sled[5].x - sled[2].x;
  const upy = sled[5].y - sled[2].y;
  const ul = Math.hypot(upx, upy) || 1;
  const ux = (upx / ul) * 5.2;
  const uy = (upy / ul) * 5.2;
  ctx.beginPath();
  ctx.moveTo(keel[0].x, keel[0].y);
  for (let i = 1; i < keel.length; i++) ctx.lineTo(keel[i].x, keel[i].y);
  for (let i = keel.length - 1; i >= 0; i--) ctx.lineTo(keel[i].x + ux, keel[i].y + uy);
  ctx.closePath();
  ctx.fillStyle = "#3a332c";
  ctx.fill();
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = "#14110e";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(keel[0].x + ux * 0.85, keel[0].y + uy * 0.85);
  for (let i = 1; i < keel.length; i++) ctx.lineTo(keel[i].x + ux * 0.85, keel[i].y + uy * 0.85);
  ctx.strokeStyle = "rgba(214, 206, 196, 0.55)";
  ctx.lineWidth = 1.15;
  ctx.stroke();

  ctx.strokeStyle = "#241f1a";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(sled[2].x + ux * 0.3, sled[2].y + uy * 0.3);
  ctx.lineTo(sled[5].x, sled[5].y);
  ctx.lineTo(sled[6].x, sled[6].y);
  ctx.stroke();

  const gx = sled[6].x;
  const gy = sled[6].y;
  const px = -uy / 5.2;
  const py = ux / 5.2;
  ctx.beginPath();
  ctx.moveTo(gx - px * 5.5, gy - py * 5.5);
  ctx.lineTo(gx + px * 5.5, gy + py * 5.5);
  ctx.lineWidth = 2.2;
  ctx.stroke();
}

function drawBoot(ctx, foot, angle, color) {
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.3;
  ctx.beginPath();
  ctx.moveTo(foot.x - fx * 4.5, foot.y - fy * 4.5);
  ctx.lineTo(foot.x + fx * 5.5, foot.y + fy * 5.5);
  ctx.stroke();
}

function strokeChain(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function inset(from, to, rad) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: to.x - (dx / d) * rad, y: to.y - (dy / d) * rad };
}

function drawFlag(ctx, flag, active, camera) {
  const geo = flagGeometry(flag);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#8d6a4a";
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.moveTo(geo.poleBase.x, geo.poleBase.y);
  ctx.lineTo(geo.poleTop.x, geo.poleTop.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(geo.poleTop.x, geo.poleTop.y + 2);
  ctx.lineTo(geo.poleTop.x + 18, geo.poleTop.y + 8);
  ctx.lineTo(geo.poleTop.x, geo.poleTop.y + 16);
  ctx.closePath();
  ctx.fillStyle = "#d7263d";
  ctx.fill();

  if (!active) return;
  ctx.beginPath();
  ctx.arc(flag.x, flag.y, 7, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(215, 38, 61, 0.9)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(flag.x, flag.y);
  ctx.lineTo(geo.handle.x, geo.handle.y);
  ctx.strokeStyle = "rgba(26, 35, 50, 0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(geo.handle.x, geo.handle.y, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = "#1a2332";
  ctx.fill();
}

function drawParticles(ctx, particles) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const t = 1 - p.age / p.life;
    ctx.fillStyle = `rgba(90, 112, 140, ${0.35 * t})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEraser(ctx, eraser, camera) {
  ctx.beginPath();
  ctx.arc(eraser.x, eraser.y, eraser.r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(26, 35, 50, 0.7)";
  ctx.lineWidth = 1.25 / camera.zoom;
  ctx.setLineDash([4 / camera.zoom, 3 / camera.zoom]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawHint(ctx, viewW, viewH) {
  ctx.save();
  ctx.fillStyle = "rgba(70, 84, 104, 0.88)";
  ctx.textAlign = "center";
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText("画一条线，按空格让他滑下去", viewW / 2, viewH * 0.72);
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = "rgba(90, 104, 124, 0.9)";
  ctx.fillText("蓝线可骑 · 红线加速 · 绿线只是风景", viewW / 2, viewH * 0.72 + 28);
  ctx.restore();
}

function drawCrashLabel(ctx, sim, camera, viewW, viewH) {
  if (!sim.crashed) return;
  const age = sim.time - sim.crashTime;
  if (age < 0 || age > 1.7) return;
  const head = sim.rider[2];
  const x = (head.x - camera.x) * camera.zoom + viewW / 2;
  const y = (head.y - camera.y) * camera.zoom + viewH / 2 - 28;
  const alpha = age < 1.15 ? 1 : 1 - (age - 1.15) / 0.55;
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = "#d7263d";
  ctx.font = `700 18px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("摔了", x, y);
  ctx.restore();
}

export function renderScene(ctx, viewW, viewH, scene) {
  const camera = scene.camera;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, viewW, viewH);

  ctx.save();
  ctx.translate(viewW / 2, viewH / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const bounds = viewBounds(camera, viewW, viewH, 80);
  drawGrid(ctx, camera, viewW, viewH);
  drawLinesOfType(ctx, scene.lines, "scenery", bounds, camera);

  if (scene.showGhosts && scene.ghosts) {
    for (let i = 0; i < scene.ghosts.length; i++) {
      const ghost = scene.ghosts[i];
      const alpha = 0.05 + (i / scene.ghosts.length) * 0.12;
      drawActor(ctx, ghost, alpha);
    }
  }

  drawLinesOfType(ctx, scene.lines, "normal", bounds, camera);
  drawLinesOfType(ctx, scene.lines, "accel", bounds, camera);
  if (scene.flag) drawFlag(ctx, scene.flag, scene.flagActive, camera);
  if (scene.preview) drawPreview(ctx, scene.preview, camera);
  if (scene.sim) {
    drawParticles(ctx, scene.sim.particles);
    drawActor(ctx, scene.sim, null);
  }
  if (scene.eraser) drawEraser(ctx, scene.eraser, camera);
  ctx.restore();

  if (scene.showHint) drawHint(ctx, viewW, viewH);
  if (scene.sim && scene.showCrashLabel !== false) drawCrashLabel(ctx, scene.sim, camera, viewW, viewH);

  if (scene.exportMark) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#5c6b80";
    ctx.font = `600 28px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("线条骑士", 48, viewH - 46);
    ctx.restore();
  }
}

export function worldToScreen(camera, viewW, viewH, x, y) {
  return {
    x: (x - camera.x) * camera.zoom + viewW / 2,
    y: (y - camera.y) * camera.zoom + viewH / 2,
  };
}
