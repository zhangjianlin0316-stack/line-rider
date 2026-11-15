import { SpatialGrid, cloneLines, eraseLines, segmentCount, simplifyPolyline } from "./lines.js";
import {
  FIXED_DT,
  applyFlag,
  createSimulation,
  stepScarf,
  stepSimulation,
} from "./physics.js";
import { flagGeometry, renderScene } from "./render.js";
import {
  deleteNamed,
  listSaves,
  loadNamed,
  parseTrack,
  readAutosave,
  readSettings,
  saveNamed,
  serializeTrack,
  writeAutosave,
  writeSettings,
} from "./storage.js";
import { sampleById, sampleTracks } from "./tracks.js";

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

const ui = {
  play: document.getElementById("btnPlay"),
  pause: document.getElementById("btnPause"),
  stop: document.getElementById("btnStop"),
  follow: document.getElementById("btnFollow"),
  ghost: document.getElementById("btnGhost"),
  speeds: [...document.querySelectorAll("[data-speed]")],
  qualities: [...document.querySelectorAll("[data-quality]")],
  tools: [...document.querySelectorAll("[data-tool]")],
  colors: [...document.querySelectorAll("[data-color]")],
  status: document.getElementById("statusText"),
  meta: document.getElementById("statusMeta"),
  toast: document.getElementById("toast"),
  saveDialog: document.getElementById("saveDialog"),
  loadDialog: document.getElementById("loadDialog"),
  helpDialog: document.getElementById("helpDialog"),
  saveName: document.getElementById("saveName"),
  saveList: document.getElementById("saveList"),
  fileInput: document.getElementById("fileInput"),
};

const settings = readSettings();
const camera = { x: 0, y: -20, zoom: 1.15 };
let flag = { x: 0, y: 0, angle: 0.06 };
let lines = [];
let trackName = "未命名赛道";
let sim = createSimulation(flag);
let grid = new SpatialGrid();
let mode = "ready";
let tool = "pencil";
let lineType = "normal";
let speed = 1;
let quality = settings.quality || "hd";
let follow = settings.follow !== false;
let showGhosts = !!settings.ghosts;
let pixelRatio = 1;
let viewW = 1;
let viewH = 1;

let undoStack = [];
let redoStack = [];
let dirty = false;
let autosaveClock = 0;

const ghosts = [];
let ghostTime = 0;

let acc = 0;
let last = performance.now();
let fps = 60;
let fpsAccum = 0;
let fpsFrames = 0;

let pointer = null;
let pointers = new Map();
let pinch = null;
let spaceDown = false;
let spaceDrag = false;
let toastTimer = 0;
let flagWheelUndo = null;

const cursorWorld = { x: 0, y: 0, inside: false };

function capture() {
  return {
    lines: cloneLines(lines),
    flag: { x: flag.x, y: flag.y, angle: flag.angle },
    name: trackName,
  };
}

function restore(snap, { repose = true } = {}) {
  lines = cloneLines(snap.lines);
  flag = { x: snap.flag.x, y: snap.flag.y, angle: snap.flag.angle };
  trackName = snap.name || trackName;
  grid.build(lines);
  if (repose && mode === "ready") applyFlag(sim, flag);
  dirty = true;
}

function pushUndo(before) {
  undoStack.push(before);
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  dirty = true;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(capture());
  restore(undoStack.pop());
  toast("已撤销");
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(capture());
  restore(redoStack.pop());
  toast("已重做");
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - viewW / 2) / camera.zoom + camera.x,
    y: (sy - viewH / 2) / camera.zoom + camera.y,
  };
}

function zoomAt(sx, sy, factor) {
  const before = screenToWorld(sx, sy);
  camera.zoom = clamp(camera.zoom * factor, 0.18, 8);
  const after = screenToWorld(sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function toast(message) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, 2200);
}

function setMode(next) {
  mode = next;
  syncToggles();
}

function play() {
  if (mode === "paused") {
    setMode("playing");
    return;
  }
  if (mode === "playing") return;
  applyFlag(sim, flag);
  grid.build(lines);
  ghosts.length = 0;
  ghostTime = 0;
  acc = 0;
  setMode("playing");
}

function pause() {
  if (mode !== "playing") return;
  setMode("paused");
}

function stop() {
  applyFlag(sim, flag);
  ghosts.length = 0;
  setMode("ready");
  if (follow) {
    camera.x = flag.x;
    camera.y = flag.y - 10;
  }
}

function togglePlay() {
  if (mode === "playing") pause();
  else play();
}

function loadTrack(track, { announce = true } = {}) {
  const before = capture();
  lines = cloneLines(track.lines);
  flag = { x: track.flag.x, y: track.flag.y, angle: track.flag.angle || 0 };
  trackName = track.name || "未命名赛道";
  grid.build(lines);
  applyFlag(sim, flag);
  ghosts.length = 0;
  setMode("ready");
  camera.x = flag.x + 80;
  camera.y = flag.y + 20;
  camera.zoom = 1.05;
  pushUndo(before);
  dirty = true;
  if (announce) toast(`已载入「${trackName}」`);
}

function clearLines() {
  if (!lines.length) return;
  const before = capture();
  lines = [];
  grid.build(lines);
  pushUndo(before);
  toast("已清空（可撤销）");
}

function setTool(next) {
  tool = next;
  syncToggles();
}

function setLineType(next) {
  lineType = next;
  syncToggles();
}

function setSpeed(next) {
  speed = next;
  syncToggles();
}

function setQuality(next) {
  quality = next;
  writeSettings({ quality });
  resize();
  syncToggles();
}

function setFollow(next) {
  follow = next;
  writeSettings({ follow });
  syncToggles();
}

function setGhosts(next) {
  showGhosts = next;
  writeSettings({ ghosts: showGhosts });
  if (!showGhosts) ghosts.length = 0;
  syncToggles();
}

function syncToggles() {
  ui.play.classList.toggle("is-on", mode === "playing");
  ui.pause.classList.toggle("is-on", mode === "paused");
  ui.stop.classList.toggle("is-on", mode === "ready");
  ui.follow.classList.toggle("is-on", follow);
  ui.follow.setAttribute("aria-pressed", String(follow));
  ui.ghost.classList.toggle("is-on", showGhosts);
  ui.ghost.setAttribute("aria-pressed", String(showGhosts));
  for (const button of ui.speeds) {
    button.classList.toggle("is-on", Number(button.dataset.speed) === speed);
  }
  for (const button of ui.qualities) {
    button.classList.toggle("is-on", button.dataset.quality === quality);
  }
  for (const button of ui.tools) {
    button.classList.toggle("is-on", button.dataset.tool === tool);
  }
  for (const button of ui.colors) {
    button.classList.toggle("is-on", button.dataset.color === lineType);
  }
  const cursors = {
    pencil: "crosshair",
    line: "crosshair",
    eraser: "none",
    hand: "grab",
    flag: "move",
  };
  canvas.style.cursor = spaceDown ? "grab" : cursors[tool] || "crosshair";
}

function computePixelRatio(cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  let ratio = dpr;
  if (quality === "hd") ratio = Math.max(dpr, cssW < 2400 ? 1.75 : dpr);
  if (quality === "4k") {
    const fit = Math.min(3840 / Math.max(cssW, 1), 2160 / Math.max(cssH, 1));
    ratio = Math.max(dpr, Math.min(4, fit));
  }
  const pixels = cssW * cssH * ratio * ratio;
  const cap = 3840 * 2160;
  if (pixels > cap) ratio *= Math.sqrt(cap / pixels);
  return ratio;
}

function resize() {
  viewW = Math.max(1, canvas.clientWidth);
  viewH = Math.max(1, canvas.clientHeight);
  pixelRatio = computePixelRatio(viewW, viewH);
  const w = Math.max(1, Math.round(viewW * pixelRatio));
  const h = Math.max(1, Math.round(viewH * pixelRatio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function updateStatus() {
  const labels = { ready: "准备", playing: sim.crashed ? "摔落" : "滑行中", paused: sim.crashed ? "摔落 · 暂停" : "已暂停" };
  const speedNow = Math.hypot(sim.vx, sim.vy);
  ui.status.textContent = `${trackName} · ${labels[mode]} · 速度 ${Math.round(speedNow)} · 线条 ${segmentCount(lines)}`;
  ui.meta.textContent = `画布 ${canvas.width}×${canvas.height}`;
}

function frame(now) {
  const real = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAccum += real;
  fpsFrames += 1;
  if (fpsAccum >= 0.4) {
    fps = Math.round(fpsFrames / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }

  if (mode !== "paused") {
    acc += real * (mode === "playing" ? speed : 1);
    let steps = 0;
    const limit = mode === "playing" ? 28 : 8;
    while (acc >= FIXED_DT && steps < limit) {
      if (mode === "playing") stepSimulation(sim, grid, FIXED_DT);
      else stepScarf(sim, FIXED_DT);
      acc -= FIXED_DT;
      steps += 1;
    }
    if (steps >= limit) acc = 0;
  }

  if (mode === "playing" && showGhosts) {
    if (sim.time - ghostTime > 0.08) {
      ghostTime = sim.time;
      ghosts.push({
        sled: sim.sled.map((p) => ({ x: p.x, y: p.y })),
        rider: sim.rider.map((p) => ({ x: p.x, y: p.y })),
        angle: sim.angle,
      });
      if (ghosts.length > 8) ghosts.shift();
    }
  }

  if (mode === "playing" && follow && !pointer) {
    const lead = 0.16;
    const tx = sim.sled[2].x + clamp(sim.vx, -2200, 2200) * lead;
    const ty = sim.sled[2].y + clamp(sim.vy, -2200, 2200) * lead;
    const k = 1 - Math.exp(-7 * real);
    camera.x += (tx - camera.x) * k;
    camera.y += (ty - camera.y) * k;
  } else if (mode === "ready" && follow && !pointer) {
    const k = 1 - Math.exp(-2.4 * real);
    camera.x += (flag.x + 40 - camera.x) * k;
    camera.y += (flag.y - camera.y) * k;
  }

  if (dirty) {
    autosaveClock += real;
    if (autosaveClock > 2) {
      autosaveClock = 0;
      dirty = false;
      try {
        writeAutosave(trackName, flag, lines);
      } catch {
        /* ignore quota */
      }
    }
  }

  paint();
  updateStatus();
  requestAnimationFrame(frame);
}

function paint() {
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const preview = pointer && pointer.preview ? pointer.preview : null;
  const eraser =
    tool === "eraser" && cursorWorld.inside
      ? { x: cursorWorld.x, y: cursorWorld.y, r: eraserRadius() }
      : null;
  renderScene(ctx, viewW, viewH, {
    camera,
    lines,
    sim,
    flag,
    flagActive: tool === "flag",
    ghosts,
    showGhosts: showGhosts && mode !== "ready",
    preview,
    eraser,
    showHint: lines.length === 0 && mode === "ready",
  });
}

function eraserRadius() {
  return 16 / camera.zoom;
}

function localPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onPointerDown(event) {
  if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    const pts = [...pointers.values()];
    const mid = localPointFromClient((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    pinch = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      zoom: camera.zoom,
      world: screenToWorld(mid.x, mid.y),
    };
    pointer = null;
    return;
  }
  const pt = localPoint(event);
  const world = screenToWorld(pt.x, pt.y);
  const pan = event.button === 1 || tool === "hand" || spaceDown;
  if (event.button === 2) {
    pointer = { kind: "erase", x: world.x, y: world.y, before: capture(), strokes: [{ x: world.x, y: world.y }] };
    return;
  }
  if (pan) {
    pointer = { kind: "pan", x: pt.x, y: pt.y, cx: camera.x, cy: camera.y };
    canvas.style.cursor = "grabbing";
    if (mode === "playing") setFollow(false);
    return;
  }
  if (tool === "pencil") {
    const before = capture();
    const stroke = { type: lineType, points: [{ x: world.x, y: world.y }] };
    lines.push(stroke);
    pointer = { kind: "pencil", before, stroke, last: world };
  } else if (tool === "line") {
    pointer = {
      kind: "line",
      before: capture(),
      ax: world.x,
      ay: world.y,
      preview: { type: lineType, points: [{ x: world.x, y: world.y }, { x: world.x, y: world.y }] },
    };
  } else if (tool === "eraser") {
    pointer = { kind: "erase", before: capture(), strokes: [{ x: world.x, y: world.y }] };
    lines = eraseLines(pointer.before.lines, pointer.strokes, eraserRadius());
    grid.build(lines);
  } else if (tool === "flag") {
    const geo = flagGeometry(flag);
    const handleDist = Math.hypot(world.x - geo.handle.x, world.y - geo.handle.y);
    pointer = {
      kind: handleDist < 14 / camera.zoom ? "flag-rot" : "flag",
      before: capture(),
      moved: false,
    };
    if (pointer.kind === "flag") moveFlag(world.x, world.y);
  }
}

function onPointerMove(event) {
  const pt = localPoint(event);
  const world = screenToWorld(pt.x, pt.y);
  cursorWorld.x = world.x;
  cursorWorld.y = world.y;
  cursorWorld.inside = true;
  if (pointers.has(event.pointerId)) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  if (pinch && pointers.size >= 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const mid = localPointFromClient((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
    camera.zoom = clamp(pinch.zoom * (dist / pinch.dist), 0.18, 8);
    camera.x = pinch.world.x - (mid.x - viewW / 2) / camera.zoom;
    camera.y = pinch.world.y - (mid.y - viewH / 2) / camera.zoom;
    return;
  }
  if (!pointer) return;
  if (pointer.kind === "pan") {
    camera.x = pointer.cx - (pt.x - pointer.x) / camera.zoom;
    camera.y = pointer.cy - (pt.y - pointer.y) / camera.zoom;
    if (spaceDown) spaceDrag = true;
    return;
  }
  if (pointer.kind === "pencil") {
    const last = pointer.last;
    const dist = Math.hypot(world.x - last.x, world.y - last.y);
    if (dist >= 3.2 / Math.sqrt(camera.zoom)) {
      pointer.stroke.points.push({ x: world.x, y: world.y });
      pointer.last = world;
      if (pointer.stroke.points.length > 2500) pointer.stroke.points.splice(1, 1);
      grid.build(lines);
    }
    return;
  }
  if (pointer.kind === "line") {
    let x = world.x;
    let y = world.y;
    if (event.shiftKey) {
      if (Math.abs(x - pointer.ax) > Math.abs(y - pointer.ay)) y = pointer.ay;
      else x = pointer.ax;
    }
    pointer.preview = {
      type: lineType,
      points: [
        { x: pointer.ax, y: pointer.ay },
        { x, y },
      ],
    };
    return;
  }
  if (pointer.kind === "erase") {
    const prev = pointer.strokes[pointer.strokes.length - 1];
    const dist = Math.hypot(world.x - prev.x, world.y - prev.y);
    if (dist > 4 / camera.zoom) pointer.strokes.push({ x: world.x, y: world.y });
    if (pointer.strokes.length > 70) {
      pointer.baseline = eraseLines(pointer.baseline || pointer.before.lines, pointer.strokes, eraserRadius());
      pointer.strokes = [{ x: world.x, y: world.y }];
      lines = cloneLines(pointer.baseline);
    } else {
      lines = eraseLines(pointer.baseline || pointer.before.lines, pointer.strokes, eraserRadius());
    }
    grid.build(lines);
    return;
  }
  if (pointer.kind === "flag") {
    moveFlag(world.x, world.y);
    pointer.moved = true;
  } else if (pointer.kind === "flag-rot") {
    flag.angle = Math.atan2(world.y - flag.y, world.x - flag.x);
    if (mode === "ready") applyFlag(sim, flag);
    pointer.moved = true;
  }
}

function localPointFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function moveFlag(x, y) {
  flag.x = x;
  flag.y = y;
  if (mode === "ready") applyFlag(sim, flag);
}

function onPointerUp(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointer) return;
  const done = pointer;
  pointer = null;
  canvas.style.cursor = "";
  syncToggles();
  if (done.kind === "pencil") {
    const stroke = done.stroke;
    if (stroke.points.length < 2) {
      lines.pop();
      grid.build(lines);
      return;
    }
    stroke.points = simplifyPolyline(stroke.points, 1.15);
    grid.build(lines);
    pushUndo(done.before);
    return;
  }
  if (done.kind === "line") {
    const pts = done.preview.points;
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    if (dist < 2) return;
    lines.push({ type: lineType, points: pts });
    grid.build(lines);
    pushUndo(done.before);
    return;
  }
  if (done.kind === "erase") {
    if (linesChanged(done.before.lines, lines)) pushUndo(done.before);
    return;
  }
  if ((done.kind === "flag" || done.kind === "flag-rot") && done.moved) {
    pushUndo(done.before);
  }
}

function linesChanged(a, b) {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i].points.length !== b[i].points.length) return true;
  }
  return false;
}

function onWheel(event) {
  event.preventDefault();
  const pt = localPoint(event);
  if (tool === "flag") {
    if (!flagWheelUndo) flagWheelUndo = capture();
    flag.angle += event.deltaY > 0 ? 0.06 : -0.06;
    if (mode === "ready") applyFlag(sim, flag);
    clearTimeout(flagWheelUndo.timer);
    flagWheelUndo.timer = setTimeout(() => {
      pushUndo(flagWheelUndo);
      flagWheelUndo = null;
    }, 280);
    return;
  }
  const factor = Math.exp(-event.deltaY * 0.0011);
  zoomAt(pt.x, pt.y, factor);
}

function exportPng() {
  const out = document.createElement("canvas");
  out.width = 3840;
  out.height = 2160;
  const octx = out.getContext("2d", { alpha: false });
  const scale = Math.min(3840 / viewW, 2160 / viewH);
  const ox = (3840 - viewW * scale) / 2;
  const oy = (2160 - viewH * scale) / 2;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.fillStyle = "#f3f5f8";
  octx.fillRect(0, 0, 3840, 2160);
  octx.setTransform(scale, 0, 0, scale, ox, oy);
  renderScene(octx, viewW, viewH, {
    camera,
    lines,
    sim,
    flag,
    flagActive: false,
    ghosts,
    showGhosts: showGhosts && mode !== "ready",
    showHint: false,
    showCrashLabel: true,
    exportMark: true,
  });
  out.toBlob((blob) => {
    if (!blob) {
      toast("导出失败");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "line-rider-4k.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("已导出 3840×2160 PNG");
  }, "image/png");
}

function openSave() {
  ui.saveName.value = trackName;
  ui.saveDialog.showModal();
  ui.saveName.focus();
  ui.saveName.select();
}

function confirmSave() {
  const name = ui.saveName.value.trim() || "未命名赛道";
  trackName = name;
  try {
    saveNamed(name, flag, lines);
    writeAutosave(name, flag, lines);
    dirty = false;
    toast(`已保存「${name}」`);
  } catch {
    toast("保存失败，浏览器存储已满");
  }
}

function openLoad() {
  const saves = listSaves();
  ui.saveList.innerHTML = "";
  if (!saves.length) {
    ui.saveList.innerHTML = '<p class="empty">还没有存档。画完可以点「保存」。</p>';
  } else {
    for (const item of saves) {
      const row = document.createElement("div");
      row.className = "save-row";
      const label = document.createElement("button");
      label.type = "button";
      label.className = "save-name";
      const when = new Date(item.savedAt);
      label.textContent = `${item.name}  ·  ${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      label.addEventListener("click", () => {
        const track = loadNamed(item.id);
        if (!track) return;
        loadTrack(track);
        ui.loadDialog.close();
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "save-del";
      del.textContent = "删除";
      del.addEventListener("click", () => {
        deleteNamed(item.id);
        openLoad();
      });
      row.append(label, del);
      ui.saveList.append(row);
    }
  }
  ui.loadDialog.showModal();
}

function downloadJson() {
  const data = serializeTrack(trackName, flag, lines);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${trackName || "track"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function importJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const track = parseTrack(JSON.parse(String(reader.result)));
      loadTrack(track);
    } catch {
      toast("无法读取这个赛道文件");
    }
  };
  reader.readAsText(file);
}

function goToFlag() {
  camera.x = flag.x;
  camera.y = flag.y;
}

function bind() {
  for (const button of ui.tools) {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  }
  for (const button of ui.colors) {
    button.addEventListener("click", () => setLineType(button.dataset.color));
  }
  for (const button of ui.speeds) {
    button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
  }
  for (const button of ui.qualities) {
    button.addEventListener("click", () => setQuality(button.dataset.quality));
  }
  ui.play.addEventListener("click", play);
  ui.pause.addEventListener("click", pause);
  ui.stop.addEventListener("click", stop);
  ui.follow.addEventListener("click", () => setFollow(!follow));
  ui.ghost.addEventListener("click", () => setGhosts(!showGhosts));
  document.getElementById("btnUndo").addEventListener("click", undo);
  document.getElementById("btnRedo").addEventListener("click", redo);
  document.getElementById("btnClear").addEventListener("click", clearLines);
  document.getElementById("btnZoomIn").addEventListener("click", () => zoomAt(viewW / 2, viewH / 2, 1.15));
  document.getElementById("btnZoomOut").addEventListener("click", () => zoomAt(viewW / 2, viewH / 2, 1 / 1.15));
  document.getElementById("btnHome").addEventListener("click", goToFlag);
  document.getElementById("btnExportPng").addEventListener("click", exportPng);
  document.getElementById("btnSave").addEventListener("click", openSave);
  document.getElementById("btnLoad").addEventListener("click", openLoad);
  document.getElementById("btnExportJson").addEventListener("click", downloadJson);
  document.getElementById("btnImport").addEventListener("click", () => ui.fileInput.click());
  document.getElementById("btnHelp").addEventListener("click", () => ui.helpDialog.showModal());
  ui.fileInput.addEventListener("change", () => {
    const file = ui.fileInput.files && ui.fileInput.files[0];
    ui.fileInput.value = "";
    if (file) importJsonFile(file);
  });
  ui.saveDialog.addEventListener("close", () => {
    if (ui.saveDialog.returnValue === "ok") confirmSave();
  });
  for (const button of document.querySelectorAll("[data-sample]")) {
    button.addEventListener("click", () => {
      const track = sampleById(button.dataset.sample);
      if (track) loadTrack(track);
    });
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", () => {
    cursorWorld.inside = false;
  });
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      openSave();
      return;
    }
    if (event.repeat) return;
    if (event.code === "Space") {
      event.preventDefault();
      spaceDown = true;
      spaceDrag = false;
      return;
    }
    if (event.key === "Escape") {
      stop();
      return;
    }
    if (key === "b") setTool("pencil");
    else if (key === "l") setTool("line");
    else if (key === "e") setTool("eraser");
    else if (key === "h") setTool("hand");
    else if (key === "f") setTool("flag");
    else if (key === "1") setLineType("normal");
    else if (key === "2") setLineType("accel");
    else if (key === "3") setLineType("scenery");
    else if (key === "c") setFollow(!follow);
    else if (key === "g") setGhosts(!showGhosts);
    else if (event.key === "[") cycleSpeed(-1);
    else if (event.key === "]") cycleSpeed(1);
    else if (key === "+" || key === "=") zoomAt(viewW / 2, viewH / 2, 1.12);
    else if (key === "-" || key === "_") zoomAt(viewW / 2, viewH / 2, 1 / 1.12);
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      if (spaceDown && !spaceDrag) togglePlay();
      spaceDown = false;
      spaceDrag = false;
      syncToggles();
    }
  });
  window.addEventListener("blur", () => {
    spaceDown = false;
  });

  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas);
  window.addEventListener("resize", resize);

  for (const dialog of [ui.saveDialog, ui.loadDialog, ui.helpDialog]) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
}

function cycleSpeed(dir) {
  const steps = [0.25, 0.5, 1, 2, 4];
  let index = steps.indexOf(speed);
  if (index < 0) index = 2;
  index = clamp(index + dir, 0, steps.length - 1);
  setSpeed(steps[index]);
}

function boot() {
  bind();
  resize();
  const params = new URLSearchParams(location.search);
  const sampleId = params.get("track");
  const sample = sampleId ? sampleById(sampleId) : null;
  if (sample) {
    lines = cloneLines(sample.lines);
    flag = { ...sample.flag };
    trackName = sample.name;
    camera.x = flag.x + 90;
    camera.y = flag.y + 10;
  } else {
    const saved = readAutosave();
    if (saved) {
      lines = saved.lines;
      flag = saved.flag;
      trackName = saved.name;
      camera.x = flag.x + 40;
      camera.y = flag.y;
    }
  }
  grid.build(lines);
  sim = createSimulation(flag);
  if (follow) {
    camera.x = flag.x + (lines.length ? 80 : 0);
    camera.y = flag.y;
  }
  syncToggles();
  if (params.get("play") === "1") play();
  requestAnimationFrame(frame);
}

boot();

window.__lr = {
  get mode() {
    return mode;
  },
  get sim() {
    return sim;
  },
  get lines() {
    return lines;
  },
  get flag() {
    return flag;
  },
  get camera() {
    return camera;
  },
  get quality() {
    return quality;
  },
  get canvas() {
    return canvas;
  },
  get pixelRatio() {
    return pixelRatio;
  },
  play,
  pause,
  stop,
  undo,
  redo,
  setTool,
  setLineType,
  setQuality,
  setSpeed,
  setFollow,
  setGhosts,
  loadSample(id) {
    const track = sampleById(id);
    if (track) loadTrack(track, { announce: false });
  },
  exportInfo() {
    return { width: canvas.width, height: canvas.height, pixelRatio, viewW, viewH, quality, fps };
  },
};
