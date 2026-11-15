/** Track lines, eraser, and a spatial hash for collision queries. */

export const LINE_TYPES = ["normal", "accel", "scenery"];

const CELL = 72;

export class SpatialGrid {
  constructor() {
    this.cell = CELL;
    this.buckets = new Map();
    this.segs = [];
    this._out = [];
    this._stamp = 1;
  }

  build(lines) {
    this.buckets.clear();
    this.segs.length = 0;
    this._stamp = 1;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (line.type === "scenery") continue;
      const pts = line.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i].x;
        const ay = pts[i].y;
        const bx = pts[i + 1].x;
        const by = pts[i + 1].y;
        if ((bx - ax) * (bx - ax) + (by - ay) * (by - ay) < 0.16) continue;
        const seg = { ax, ay, bx, by, type: line.type, stamp: 0 };
        this.segs.push(seg);
        const minx = Math.floor(Math.min(ax, bx) / CELL);
        const maxx = Math.floor(Math.max(ax, bx) / CELL);
        const miny = Math.floor(Math.min(ay, by) / CELL);
        const maxy = Math.floor(Math.max(ay, by) / CELL);
        for (let ix = minx; ix <= maxx; ix++) {
          for (let iy = miny; iy <= maxy; iy++) {
            const k = cellKey(ix, iy);
            let bucket = this.buckets.get(k);
            if (!bucket) {
              bucket = [];
              this.buckets.set(k, bucket);
            }
            bucket.push(seg);
          }
        }
      }
    }
  }

  query(x0, y0, x1, y1, margin) {
    const out = this._out;
    out.length = 0;
    const stamp = ++this._stamp;
    if (stamp > 1e9) {
      for (let i = 0; i < this.segs.length; i++) this.segs[i].stamp = 0;
      this._stamp = 1;
    }
    const minx = Math.floor((Math.min(x0, x1) - margin) / CELL);
    const maxx = Math.floor((Math.max(x0, x1) + margin) / CELL);
    const miny = Math.floor((Math.min(y0, y1) - margin) / CELL);
    const maxy = Math.floor((Math.max(y0, y1) + margin) / CELL);
    for (let ix = minx; ix <= maxx; ix++) {
      for (let iy = miny; iy <= maxy; iy++) {
        const bucket = this.buckets.get(cellKey(ix, iy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const seg = bucket[i];
          if (seg.stamp === this._stamp) continue;
          seg.stamp = this._stamp;
          out.push(seg);
        }
      }
    }
    return out;
  }
}

function cellKey(ix, iy) {
  return (ix + 0x800000) * 0x1000000 + (iy + 0x800000);
}

export function cloneLines(lines) {
  return lines.map((line) => ({
    type: line.type,
    points: line.points.map((p) => ({ x: p.x, y: p.y })),
  }));
}

export function segmentCount(lines) {
  let n = 0;
  for (let i = 0; i < lines.length; i++) n += Math.max(0, lines[i].points.length - 1);
  return n;
}

function circleInterval(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  if (a < 1e-8) return c <= 0 ? [0, 1] : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t0 = (-b - s) / (2 * a);
  let t1 = (-b + s) / (2 * a);
  if (t1 < 0 || t0 > 1) return null;
  t0 = Math.max(0, t0);
  t1 = Math.min(1, t1);
  if (t1 - t0 < 1e-4) return null;
  return [t0, t1];
}

function pointAt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function eraseLines(lines, strokes, radius) {
  if (!strokes.length) return cloneLines(lines);
  const out = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const pts = line.points;
    if (pts.length < 2) continue;
    let current = [];
    const flush = () => {
      if (current.length >= 2) out.push({ type: line.type, points: current });
      current = [];
    };
    const add = (p) => {
      const last = current[current.length - 1];
      if (!last || (last.x - p.x) * (last.x - p.x) + (last.y - p.y) * (last.y - p.y) > 0.04) {
        current.push(p);
      }
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const marks = [0, 1];
      for (let s = 0; s < strokes.length; s++) {
        const iv = circleInterval(a.x, a.y, b.x, b.y, strokes[s].x, strokes[s].y, radius);
        if (iv) marks.push(iv[0], iv[1]);
      }
      marks.sort((u, v) => u - v);
      const ts = [];
      for (let k = 0; k < marks.length; k++) {
        const t = Math.max(0, Math.min(1, marks[k]));
        if (!ts.length || t - ts[ts.length - 1] > 1e-4) ts.push(t);
      }
      for (let k = 0; k < ts.length - 1; k++) {
        const t0 = ts[k];
        const t1 = ts[k + 1];
        const mid = pointAt(a, b, (t0 + t1) * 0.5);
        let inside = false;
        for (let s = 0; s < strokes.length; s++) {
          const dx = mid.x - strokes[s].x;
          const dy = mid.y - strokes[s].y;
          if (dx * dx + dy * dy <= radius * radius) {
            inside = true;
            break;
          }
        }
        if (inside) {
          flush();
          continue;
        }
        add(pointAt(a, b, t0));
        add(pointAt(a, b, t1));
      }
    }
    flush();
  }
  return out;
}

export function simplifyPolyline(points, epsilon) {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const eps2 = epsilon * epsilon;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const ax = points[a].x;
    const ay = points[a].y;
    const bx = points[b].x;
    const by = points[b].y;
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby || 1e-8;
    for (let i = a + 1; i < b; i++) {
      const t = ((points[i].x - ax) * abx + (points[i].y - ay) * aby) / len2;
      const qx = ax + abx * t;
      const qy = ay + aby * t;
      const dx = points[i].x - qx;
      const dy = points[i].y - qy;
      const d = dx * dx + dy * dy;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > eps2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  }
  return out;
}
