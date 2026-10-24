'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  let t = lengthSq === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.sqrt(dx * dx + dy * dy);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderAt(size) {
  const scale = size / 256;
  const ss = size <= 64 ? 6 : 4;
  const n = size * ss;
  const hi = new Uint8ClampedArray(n * n * 4);

  const rounded = { l: 6 * scale, t: 6 * scale, r: 250 * scale, b: 250 * scale, rad: 54 * scale };
  const page = [
    [54, 38], [164, 38], [202, 76], [202, 218], [54, 218]
  ].map(([x, y]) => [x * scale, y * scale]);
  const shadowPage = page.map(([x, y]) => [x, y + 7 * scale]);
  const fold = [
    [164, 38], [164, 76], [202, 76]
  ].map(([x, y]) => [x * scale, y * scale]);

  const strokes = [
    [82, 158, 82, 112],
    [82, 112, 112, 142],
    [112, 142, 142, 112],
    [142, 112, 142, 158],
    [168, 108, 168, 152],
    [154, 138, 168, 152],
    [168, 152, 182, 138]
  ].map(([x1, y1, x2, y2]) => [x1 * scale, y1 * scale, x2 * scale, y2 * scale]);
  const strokeWidth = 13 * scale;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function blend(o, r, g, b, a) {
    const alpha = a / 255;
    const outA = alpha + (o[3] / 255) * (1 - alpha);
    if (outA <= 0) return;
    o[0] = Math.round((r * alpha + o[0] * (o[3] / 255) * (1 - alpha)) / outA);
    o[1] = Math.round((g * alpha + o[1] * (o[3] / 255) * (1 - alpha)) / outA);
    o[2] = Math.round((b * alpha + o[2] * (o[3] / 255) * (1 - alpha)) / outA);
    o[3] = Math.round(outA * 255);
  }

  for (let py = 0; py < n; py += 1) {
    const y = (py + 0.5) / ss;
    for (let px = 0; px < n; px += 1) {
      const x = (px + 0.5) / ss;
      const idx = (py * n + px) * 4;
      const o = [0, 0, 0, 0];

      if (insideRoundedRect(x, y, rounded.l, rounded.t, rounded.r, rounded.b, rounded.rad)) {
        const t = Math.max(0, Math.min(1, (x - rounded.l) / (rounded.r - rounded.l) * 0.4 + (y - rounded.t) / (rounded.b - rounded.t) * 0.6));
        let r = Math.round(lerp(64, 0, t));
        let g = Math.round(lerp(157, 82, t));
        let b = Math.round(lerp(255, 210, t));
        const glow = Math.max(0, 1 - Math.sqrt((x - 70 * scale) ** 2 + (y - 48 * scale) ** 2) / (170 * scale));
        if (glow > 0) {
          r = Math.round(lerp(r, 166, glow * 0.14));
          g = Math.round(lerp(g, 213, glow * 0.14));
          b = Math.round(lerp(b, 255, glow * 0.14));
        }
        o[0] = r; o[1] = g; o[2] = b; o[3] = 255;
      }

      if (insideRoundedRect(x, y, rounded.l, rounded.t, rounded.r, rounded.b, rounded.rad) && pointInPolygon(x, y, shadowPage)) {
        blend(o, 4, 22, 18, 58);
      }
      if (pointInPolygon(x, y, page)) {
        const shade = Math.max(0, Math.min(1, (y - 38 * scale) / (180 * scale)));
        blend(o, Math.round(lerp(255, 240, shade)), Math.round(lerp(253, 249, shade)), Math.round(lerp(250, 243, shade)), 255);
      }
      if (pointInPolygon(x, y, fold)) {
        blend(o, 202, 226, 255, 255);
        const edge = Math.abs((x - 164 * scale) - (y - 38 * scale));
        if (edge < 1.2 * scale) blend(o, 18, 92, 196, 90);
      }

      let hit = false;
      for (const [x1, y1, x2, y2] of strokes) {
        if (distanceToSegment(x, y, x1, y1, x2, y2) <= strokeWidth / 2) { hit = true; break; }
      }
      if (hit) blend(o, 12, 76, 170, 255);

      hi[idx] = o[0];
      hi[idx + 1] = o[1];
      hi[idx + 2] = o[2];
      hi[idx + 3] = o[3];
    }
  }

  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let pr = 0, pg = 0, pb = 0, pa = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const i = (((y * ss + sy) * n) + (x * ss + sx)) * 4;
          const a = hi[i + 3] / 255;
          pr += hi[i] * a;
          pg += hi[i + 1] * a;
          pb += hi[i + 2] * a;
          pa += a;
        }
      }
      const count = ss * ss;
      const idx = (y * size + x) * 4;
      if (pa === 0) {
        out[idx] = 0; out[idx + 1] = 0; out[idx + 2] = 0; out[idx + 3] = 0;
      } else {
        out[idx] = Math.round(pr / pa);
        out[idx + 1] = Math.round(pg / pa);
        out[idx + 2] = Math.round(pb / pa);
        out[idx + 3] = Math.round((pa / count) * 255);
      }
    }
  }
  return out;
}

const buildDir = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

const pngEntries = SIZES.map((size) => ({ size, png: encodePng(size, size, renderAt(size)) }));
fs.writeFileSync(path.join(buildDir, 'icon.png'), encodePng(512, 512, renderAt(512)));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngEntries.length, 4);
const directory = Buffer.alloc(16 * pngEntries.length);
let offset = 6 + directory.length;
pngEntries.forEach((entry, index) => {
  const pos = index * 16;
  directory[pos] = entry.size >= 256 ? 0 : entry.size;
  directory[pos + 1] = entry.size >= 256 ? 0 : entry.size;
  directory[pos + 2] = 0;
  directory[pos + 3] = 0;
  directory.writeUInt16LE(1, pos + 4);
  directory.writeUInt16LE(32, pos + 6);
  directory.writeUInt32LE(entry.png.length, pos + 8);
  directory.writeUInt32LE(offset, pos + 12);
  offset += entry.png.length;
});
fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([header, directory, ...pngEntries.map((entry) => entry.png)]));
console.log('Wrote build/icon.ico (' + SIZES.join(', ') + ') and build/icon.png');
