/** localStorage saves plus JSON import/export. */

const STORAGE_KEY = "linerider.v1";
const VALID = new Set(["normal", "accel", "scenery"]);

function bucket() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { saves: [], autosave: null, settings: {} };
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return { saves: [], autosave: null, settings: {} };
    data.saves = Array.isArray(data.saves) ? data.saves : [];
    data.settings = data.settings || {};
    return data;
  } catch {
    return { saves: [], autosave: null, settings: {} };
  }
}

function writeBucket(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function round(n) {
  return Math.round(n * 100) / 100;
}

export function serializeTrack(name, flag, lines) {
  return {
    version: 1,
    name: name || "未命名赛道",
    flag: {
      x: round(flag.x),
      y: round(flag.y),
      angle: round(flag.angle || 0),
    },
    lines: lines.map((line) => ({
      type: VALID.has(line.type) ? line.type : "normal",
      points: line.points.map((p) => [round(p.x), round(p.y)]),
    })),
  };
}

export function parseTrack(data) {
  if (!data || typeof data !== "object") throw new Error("bad");
  const flagIn = data.flag || {};
  const flag = {
    x: Number(flagIn.x) || 0,
    y: Number(flagIn.y) || 0,
    angle: Number(flagIn.angle) || 0,
  };
  if (!Array.isArray(data.lines)) throw new Error("bad");
  const lines = [];
  for (const line of data.lines) {
    if (!line || !Array.isArray(line.points)) continue;
    const type = VALID.has(line.type) ? line.type : "normal";
    const points = [];
    for (const p of line.points) {
      if (Array.isArray(p) && p.length >= 2) points.push({ x: Number(p[0]) || 0, y: Number(p[1]) || 0 });
      else if (p && typeof p === "object") points.push({ x: Number(p.x) || 0, y: Number(p.y) || 0 });
    }
    if (points.length >= 2) lines.push({ type, points });
  }
  return {
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 40) : "未命名赛道",
    flag,
    lines,
  };
}

export function listSaves() {
  return bucket().saves.map((item) => ({
    id: item.id,
    name: item.name,
    savedAt: item.savedAt,
  }));
}

export function saveNamed(name, flag, lines) {
  const data = bucket();
  const track = serializeTrack(name, flag, lines);
  const id = `t${Date.now().toString(36)}`;
  data.saves.unshift({ id, name: track.name, savedAt: Date.now(), track });
  data.saves = data.saves.slice(0, 24);
  writeBucket(data);
  return id;
}

export function loadNamed(id) {
  const item = bucket().saves.find((entry) => entry.id === id);
  if (!item) return null;
  return parseTrack(item.track);
}

export function deleteNamed(id) {
  const data = bucket();
  data.saves = data.saves.filter((entry) => entry.id !== id);
  writeBucket(data);
}

export function writeAutosave(name, flag, lines) {
  const data = bucket();
  data.autosave = serializeTrack(name, flag, lines);
  writeBucket(data);
}

export function readAutosave() {
  const data = bucket();
  if (!data.autosave) return null;
  try {
    return parseTrack(data.autosave);
  } catch {
    return null;
  }
}

export function readSettings() {
  return { ...bucket().settings };
}

export function writeSettings(partial) {
  const data = bucket();
  data.settings = { ...data.settings, ...partial };
  writeBucket(data);
}
