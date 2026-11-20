// gta6-meme-x-01 — the meme-making program.
//
// It rebuilds the GTA 6 meme that was posted on X for make.fun's
// "Post a GTA 6 meme on X" bounty, from the scene picture it ships with,
// and hands in the post's address.
//
//   scene.png                      the AI-made scene (ghost mascot at the
//                                  gaming desk, neon Vice City on the monitor)
//   font/DejaVuSans-Bold.ttf       the caption face (DejaVu Sans Bold, free)
//   POST.json                      {"url": "https://x.com/wanrin/status/2123597270210040231"}
//
// What it does, in order:
//   1. copies POST.json from the repository to /output/POST.json (the gate
//      reads the post's address from there; the house then reads the post
//      itself from X — nothing written here about the post is judged);
//   2. draws the meme's three caption lines onto the scene with a small
//      TrueType rasteriser written for this entry (no dependencies, no
//      network, no clock): a white top line, a white line above the
//      bottom band, and the gold "make.fun" wordmark line;
//   3. writes the finished 1600x1600 meme as /output/meme.png.
//
// The run is deterministic: the same repository always writes the same
// bytes (same PNG encoder, same rasteriser, no timestamps, no randomness).

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const SCENE_FILE = 'scene.png';
const FONT_FILE = join('font', 'DejaVuSans-Bold.ttf');

// The captions, exactly as on the posted meme. Each line is placed by the
// top edge of its white/gold fill (measured off the posted picture) and
// centred on x = 800, the middle of the 1600-wide canvas.
interface Caption {
  text: string;
  size: number; // em size in pixels
  top: number; // y of the fill's top edge
  fill: [number, number, number];
  outline: number; // black outline radius in pixels
}

const CAPTIONS: Caption[] = [
  { text: 'GTA 6 IS FINALLY HERE', size: 99, top: 106, fill: [255, 255, 255], outline: 5 },
  { text: 'my AI agent already got paid because of it \u2014 on', size: 54, top: 1362, fill: [255, 255, 255], outline: 3 },
  { text: 'make.fun', size: 120, top: 1461, fill: [255, 209, 26], outline: 6 },
];

const IMAGE_W = 1600;
const IMAGE_H = 1600;

// ---------------------------------------------------------------------------
// CRC-32 (PNG chunk checksums)
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// PNG decoding (8-bit, non-interlaced; colour types 0, 2, 4, 6)
// ---------------------------------------------------------------------------

interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, row-major
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(buf: Buffer): RgbaImage {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('scene.png is not a PNG file');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const dataStart = pos + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) throw new Error(`PNG chunk ${type} overruns the file`);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataEnd + 4;
  }
  if (width === 0 || height === 0) throw new Error('scene.png has no IHDR chunk');
  if (bitDepth !== 8) throw new Error(`scene.png bit depth ${bitDepth} is not 8`);
  if (interlace !== 0) throw new Error('scene.png is interlaced, this decoder takes none');
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (channels === 0) throw new Error(`scene.png colour type ${colorType} is not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('scene.png pixel data is short');
  const data = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const row = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    const out = new Uint8Array(stride);
    const bpp = channels;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`scene.png uses filter ${filter}, not supported`);
      out[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      if (channels === 4) {
        data[d] = out[s];
        data[d + 1] = out[s + 1];
        data[d + 2] = out[s + 2];
        data[d + 3] = out[s + 3];
      } else if (channels === 3) {
        data[d] = out[s];
        data[d + 1] = out[s + 1];
        data[d + 2] = out[s + 2];
        data[d + 3] = 255;
      } else if (channels === 2) {
        data[d] = out[s];
        data[d + 1] = out[s];
        data[d + 2] = out[s];
        data[d + 3] = out[s + 1];
      } else {
        data[d] = out[s];
        data[d + 1] = out[s];
        data[d + 2] = out[s];
        data[d + 3] = 255;
      }
    }
    prev = out;
  }
  return { width, height, data };
}

// ---------------------------------------------------------------------------
// PNG encoding (8-bit RGBA, filter 0 on every row, zlib level 9)
// ---------------------------------------------------------------------------

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

function encodePng(img: RgbaImage): Buffer {
  const { width, height, data } = img;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// TrueType reading (just enough to draw one bold face: head, maxp, hhea,
// hmtx, cmap format 4/12, loca, glyf simple outlines)
// ---------------------------------------------------------------------------

class Reader {
  private view: DataView;
  private buf: Buffer;
  constructor(buf: Buffer) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(off: number): number {
    return this.view.getUint8(off);
  }
  u16(off: number): number {
    return this.view.getUint16(off, false);
  }
  i16(off: number): number {
    return this.view.getInt16(off, false);
  }
  u32(off: number): number {
    return this.view.getUint32(off, false);
  }
}

interface GlyphPoint {
  x: number;
  y: number;
  on: boolean;
}

class Font {
  readonly unitsPerEm: number;
  private locaFormat: number;
  private numGlyphs: number;
  private numHMetrics: number;
  private cmap4: { start: number; end: number; delta: number; rangeOff: number }[] = [];
  private cmap4Glyphs: number;
  private cmap12: { start: number; end: number; glyph: number }[] = [];
  private kernPairs = new Map<string, number>();
  private locaOff: number;
  private glyfOff: number;
  private hmtxOff: number;
  private r: Reader;

  constructor(buf: Buffer) {
    this.r = new Reader(buf);
    const numTables = this.r.u16(4);
    const tables = new Map<string, number>();
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      const tag = buf.toString('ascii', off, off + 4);
      tables.set(tag, this.r.u32(off + 8));
    }
    const need = ['head', 'maxp', 'hhea', 'hmtx', 'cmap', 'loca', 'glyf'];
    for (const t of need) {
      if (!tables.has(t)) throw new Error(`font is missing the ${t} table`);
    }
    const head = tables.get('head') as number;
    this.unitsPerEm = this.r.u16(head + 18);
    this.locaFormat = this.r.i16(head + 50);
    this.numGlyphs = this.r.u16((tables.get('maxp') as number) + 4);
    this.numHMetrics = this.r.u16((tables.get('hhea') as number) + 34);
    this.hmtxOff = tables.get('hmtx') as number;
    this.locaOff = tables.get('loca') as number;
    this.glyfOff = tables.get('glyf') as number;
    this.readCmap(tables.get('cmap') as number);
    if (tables.has('kern')) this.readKern(tables.get('kern') as number);
  }

  // Kerning pairs from the kern table (format 0 subtables, horizontal).
  private readKern(off: number): void {
    const nTables = this.r.u16(off + 2);
    let p = off + 4;
    for (let t = 0; t < nTables; t++) {
      const version = this.r.u16(p);
      const length = this.r.u16(p + 2);
      const coverage = this.r.u16(p + 4);
      if (version === 0 && (coverage & 0x01) === 1) {
        const nPairs = this.r.u16(p + 6);
        for (let i = 0; i < nPairs; i++) {
          const q = p + 14 + i * 6;
          const left = this.r.u16(q);
          const right = this.r.u16(q + 2);
          const value = this.r.i16(q + 4);
          this.kernPairs.set(`${left},${right}`, value);
        }
      }
      p += length;
    }
  }

  // Kerning adjustment between two glyphs, in font units (0 when unlisted).
  kern(left: number, right: number): number {
    return this.kernPairs.get(`${left},${right}`) ?? 0;
  }

  private readCmap(off: number): void {
    const numSub = this.r.u16(off + 2);
    let fmt4 = -1;
    let fmt12 = -1;
    for (let i = 0; i < numSub; i++) {
      const sub = off + 4 + i * 8;
      const format = this.r.u16(off + this.r.u32(sub + 4));
      if (format === 12) fmt12 = off + this.r.u32(sub + 4);
      else if (format === 4) fmt4 = off + this.r.u32(sub + 4);
    }
    if (fmt12 >= 0) {
      const nGroups = this.r.u32(fmt12 + 12);
      for (let i = 0; i < nGroups; i++) {
        const g = fmt12 + 16 + i * 12;
        this.cmap12.push({ start: this.r.u32(g), end: this.r.u32(g + 4), glyph: this.r.u32(g + 8) });
      }
      return;
    }
    if (fmt4 < 0) throw new Error('font cmap has neither format 12 nor format 4');
    const segCount = this.r.u16(fmt4 + 6) / 2;
    const endBase = fmt4 + 14;
    const startBase = endBase + 2 * segCount + 2;
    const deltaBase = startBase + 2 * segCount;
    const rangeBase = deltaBase + 2 * segCount;
    this.cmap4Glyphs = rangeBase + 2 * segCount;
    for (let i = 0; i < segCount; i++) {
      this.cmap4.push({
        start: this.r.u16(startBase + 2 * i),
        end: this.r.u16(endBase + 2 * i),
        delta: this.r.i16(deltaBase + 2 * i),
        rangeOff: this.r.u16(rangeBase + 2 * i),
      });
    }
  }

  glyphIndex(code: number): number {
    if (this.cmap12.length > 0) {
      for (const g of this.cmap12) {
        if (code >= g.start && code <= g.end) return g.glyph + (code - g.start);
      }
      return 0;
    }
    for (const s of this.cmap4) {
      if (code < s.start || code > s.end) continue;
      if (s.rangeOff === 0) return (code + s.delta) & 0xffff;
      const addr = this.cmap4Glyphs + s.rangeOff + 2 * (code - s.start);
      const g = this.r.u16(addr);
      return g === 0 ? 0 : (g + s.delta) & 0xffff;
    }
    return 0;
  }

  advance(glyph: number): number {
    const g = Math.min(glyph, this.numHMetrics - 1);
    return this.r.u16(this.hmtxOff + g * 4);
  }

  private glyphOffset(glyph: number): [number, number] {
    if (this.locaFormat === 0) {
      const a = this.r.u16(this.locaOff + glyph * 2) * 2;
      const b = this.r.u16(this.locaOff + (glyph + 1) * 2) * 2;
      return [a, b];
    }
    const a = this.r.u32(this.locaOff + glyph * 4);
    const b = this.r.u32(this.locaOff + (glyph + 1) * 4);
    return [a, b];
  }

  // Outline of one glyph as a list of polygons (font units, y up).
  // Only simple glyphs are handled: every character this meme needs is one.
  outline(glyph: number): number[][][] {
    const [start, end] = this.glyphOffset(glyph);
    if (end <= start) return [];
    const off = this.glyfOff + start;
    const numContours = this.r.i16(off);
    if (numContours < 0) throw new Error(`glyph ${glyph} is a compound glyph, not handled`);
    if (numContours === 0) return [];
    const endPts: number[] = [];
    for (let i = 0; i < numContours; i++) endPts.push(this.r.u16(off + 10 + i * 2));
    const numPoints = endPts[endPts.length - 1] + 1;
    const instrLen = this.r.u16(off + 10 + numContours * 2);
    let p = off + 12 + numContours * 2 + instrLen;
    const flags: number[] = [];
    while (flags.length < numPoints) {
      const f = this.r.u8(p++);
      flags.push(f);
      if (f & 0x08) {
        const rep = this.r.u8(p++);
        for (let i = 0; i < rep; i++) flags.push(f);
      }
    }
    const xs: number[] = [];
    let x = 0;
    for (let i = 0; i < numPoints; i++) {
      const f = flags[i];
      if (f & 0x02) {
        const b = this.r.u8(p++);
        x += f & 0x10 ? b : -b;
      } else if (!(f & 0x10)) {
        x += this.r.i16(p);
        p += 2;
      }
      xs.push(x);
    }
    const ys: number[] = [];
    let y = 0;
    for (let i = 0; i < numPoints; i++) {
      const f = flags[i];
      if (f & 0x04) {
        const b = this.r.u8(p++);
        y += f & 0x20 ? b : -b;
      } else if (!(f & 0x20)) {
        y += this.r.i16(p);
        p += 2;
      }
      ys.push(y);
    }
    const points: GlyphPoint[] = xs.map((px, i) => ({ x: px, y: ys[i], on: (flags[i] & 0x01) !== 0 }));
    const polys: number[][][] = [];
    let first = 0;
    for (const last of endPts) {
      polys.push(this.flattenContour(points.slice(first, last + 1)));
      first = last + 1;
    }
    return polys;
  }

  private flattenContour(pts: GlyphPoint[]): number[][] {
    const n = pts.length;
    if (n === 0) return [];
    // Insert an implied on-curve point between two off-curve neighbours,
    // the contour being circular.
    const exp: GlyphPoint[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      exp.push(a);
      if (!a.on && !b.on) exp.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
    }
    const s = exp.findIndex((pt) => pt.on);
    if (s < 0) return [];
    const rot = [...exp.slice(s), ...exp.slice(0, s)];
    const seq = [...rot, rot[0]]; // close the contour
    const poly: number[][] = [[seq[0].x, seq[0].y]];
    let cur: GlyphPoint = seq[0];
    for (let i = 1; i < seq.length; i++) {
      const pt = seq[i];
      if (pt.on) {
        poly.push([pt.x, pt.y]);
        cur = pt;
      } else {
        const nxt = seq[i + 1];
        const steps = 12;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const mt = 1 - t;
          poly.push([
            mt * mt * cur.x + 2 * mt * t * pt.x + t * t * nxt.x,
            mt * mt * cur.y + 2 * mt * t * pt.y + t * t * nxt.y,
          ]);
        }
        cur = nxt;
        i++; // the endpoint was consumed as the curve's end
      }
    }
    return poly;
  }
}

// ---------------------------------------------------------------------------
// Rasterising: one glyph's outline to a coverage mask, one line of text to a
// coverage canvas, then a black outline dilated around the fill.
// ---------------------------------------------------------------------------

const SS = 4; // supersampling per pixel side (16 samples per pixel)

interface GlyphMask {
  mask: Float32Array; // coverage 0..1, row-major, mw x mh
  mw: number;
  mh: number;
  left: number; // mask's left edge, in pixels from the pen position
  top: number; // mask's top edge, in pixels above the baseline (negative = above)
  advance: number; // pen advance in pixels
}

// Scanline fill of polygons (non-zero winding) at SSx supersampling, then
// a 4x4 box downsample to per-pixel coverage.
function rasterizePolys(polys: number[][][], scale: number): GlyphMask {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  if (!isFinite(xMin)) {
    return { mask: new Float32Array(0), mw: 0, mh: 0, left: 0, top: 0, advance: 0 };
  }
  const ox = Math.floor(xMin * scale);
  const oy = Math.floor(-yMax * scale);
  const mw = Math.max(1, Math.ceil(xMax * scale) - ox);
  const mh = Math.max(1, Math.ceil(-yMin * scale) - oy);
  const w4 = mw * SS;
  const h4 = mh * SS;
  const grid = new Uint8Array(w4 * h4);
  // Polygons in sub-pixel coordinates relative to the mask origin.
  const edges: [number, number, number, number][] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const ax = (x1 * scale - ox) * SS;
      const ay = (-y1 * scale - oy) * SS;
      const bx = (x2 * scale - ox) * SS;
      const by = (-y2 * scale - oy) * SS;
      if (ay !== by) edges.push([ax, ay, bx, by]);
    }
  }
  for (let sy = 0; sy < h4; sy++) {
    const y = sy + 0.5;
    const xs: [number, number][] = [];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= y && y < by) || (by <= y && y < ay)) {
        xs.push([ax + ((y - ay) * (bx - ax)) / (by - ay), by > ay ? 1 : -1]);
      }
    }
    if (xs.length === 0) continue;
    xs.sort((a, b) => a[0] - b[0]);
    let winding = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      winding += xs[i][1];
      if (winding !== 0) {
        const x0 = Math.max(0, Math.floor(xs[i][0]));
        const x1 = Math.min(w4, Math.ceil(xs[i + 1][0]));
        for (let x = x0; x < x1; x++) grid[sy * w4 + x] = 1;
      }
    }
  }
  const mask = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      let sum = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) sum += grid[(y * SS + dy) * w4 + x * SS + dx];
      }
      mask[y * mw + x] = sum / (SS * SS);
    }
  }
  return { mask, mw, mh, left: ox, top: oy, advance: 0 };
}

interface LineCanvas {
  cov: Float32Array; // fill coverage 0..1
  w: number;
  h: number;
  pad: number; // padding around the fill bbox inside this canvas
  fillW: number; // fill bbox width
  fillH: number; // fill bbox height
}

function renderLine(font: Font, text: string, size: number, outline: number): LineCanvas {
  const scale = size / font.unitsPerEm;
  const cache = new Map<string, GlyphMask>();
  const glyphs: { m: GlyphMask; x: number }[] = [];
  let cursor = 0;
  let prevGlyph = -1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    let g = cache.get(ch);
    if (!g) {
      const gi = font.glyphIndex(code);
      if (gi === 0 && code !== 32) throw new Error(`character ${JSON.stringify(ch)} is not in the font`);
      const adv = font.advance(gi);
      if (gi === 0) {
        g = { mask: new Float32Array(0), mw: 0, mh: 0, left: 0, top: 0, advance: adv * scale };
      } else {
        const m = rasterizePolys(font.outline(gi), scale);
        m.advance = adv * scale;
        g = m;
      }
      cache.set(ch, g);
    }
    const gi = font.glyphIndex(code);
    if (prevGlyph >= 0 && gi !== 0) cursor += font.kern(prevGlyph, gi) * scale;
    prevGlyph = gi;
    if (g.mw > 0) {
      const gx = cursor + g.left;
      const gy = g.top;
      glyphs.push({ m: g, x: gx });
      if (gx < minX) minX = gx;
      if (gx + g.mw > maxX) maxX = gx + g.mw;
      if (gy < minY) minY = gy;
      if (gy + g.mh > maxY) maxY = gy + g.mh;
    }
    cursor += g.advance;
  }
  if (!isFinite(minX)) throw new Error(`line ${JSON.stringify(text)} has no glyphs`);
  const pad = outline + 2;
  const fillW = Math.ceil(maxX - minX);
  const fillH = Math.ceil(maxY - minY);
  const w = fillW + pad * 2;
  const h = fillH + pad * 2;
  const cov = new Float32Array(w * h);
  for (const { m, x } of glyphs) {
    const dx = Math.round(x - minX) + pad;
    const dy = Math.round(m.top - minY) + pad;
    for (let y = 0; y < m.mh; y++) {
      for (let px = 0; px < m.mw; px++) {
        const c = m.mask[y * m.mw + px];
        if (c > 0) {
          const idx = (dy + y) * w + (dx + px);
          if (cov[idx] < c) cov[idx] = c;
        }
      }
    }
  }
  return { cov, w, h, pad, fillW, fillH };
}

// Binary dilation of the fill (coverage > 0.25) by a disc of radius r,
// returned as a 0..1 mask the outline is drawn with.
function dilate(cov: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h);
  const offs: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) offs.push([dx, dy]);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cov[y * w + x] <= 0.25) continue;
      for (const [dx, dy] of offs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) out[ny * w + nx] = 1;
      }
    }
  }
  return out;
}

function blendPixel(img: RgbaImage, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return;
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  const ia = 1 - a;
  img.data[i] = Math.round(r * a + img.data[i] * ia);
  img.data[i + 1] = Math.round(g * a + img.data[i + 1] * ia);
  img.data[i + 2] = Math.round(b * a + img.data[i + 2] * ia);
}

// Draw one caption line onto the image: black outline first, fill on top.
// The line's fill bbox is centred on x = 800 with its top at cap.top.
function drawCaption(img: RgbaImage, font: Font, cap: Caption): void {
  const line = renderLine(font, cap.text, cap.size, cap.outline);
  const outlineMask = dilate(line.cov, line.w, line.h, cap.outline);
  const left = Math.round(IMAGE_W / 2 - (line.pad + line.fillW / 2));
  const top = Math.round(cap.top - line.pad);
  for (let y = 0; y < line.h; y++) {
    for (let x = 0; x < line.w; x++) {
      const idx = y * line.w + x;
      const o = outlineMask[idx];
      const f = line.cov[idx];
      if (o > 0 && f < 1) blendPixel(img, left + x, top + y, 0, 0, 0, o * (1 - f));
      if (f > 0) blendPixel(img, left + x, top + y, cap.fill[0], cap.fill[1], cap.fill[2], f);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Hand in the post's address: POST.json goes to /output/POST.json.
  const postPath = join(BOT_DIR, 'POST.json');
  let postBytes: Buffer;
  try {
    postBytes = readFileSync(postPath);
  } catch {
    console.error(`POST.json could not be read from ${BOT_DIR}`);
    process.exit(1);
  }
  try {
    JSON.parse(postBytes.toString('utf8'));
  } catch {
    console.error('POST.json is not valid JSON');
    process.exit(1);
  }
  copyFileSync(postPath, join(OUTPUT_DIR, 'POST.json'));

  // 2. Rebuild the meme: scene picture + three caption lines.
  const scene = decodePng(readFileSync(join(BOT_DIR, SCENE_FILE)));
  if (scene.width !== IMAGE_W || scene.height !== IMAGE_H) {
    throw new Error(`scene.png is ${scene.width}x${scene.height}, expected ${IMAGE_W}x${IMAGE_H}`);
  }
  const font = new Font(readFileSync(join(BOT_DIR, FONT_FILE)));
  for (const cap of CAPTIONS) drawCaption(scene, font, cap);

  // 3. Write the finished meme next to POST.json.
  const png = encodePng(scene);
  writeFileSync(join(OUTPUT_DIR, 'meme.png'), png);

  console.log(`POST.json copied (${postBytes.length} bytes)`);
  console.log(`meme.png: ${IMAGE_W}x${IMAGE_H}, ${png.length} bytes`);
}

main();
