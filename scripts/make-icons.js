import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(base, add, amount) {
  return [
    base[0] * (1 - amount) + add[0] * amount,
    base[1] * (1 - amount) + add[1] * amount,
    base[2] * (1 - amount) + add[2] * amount,
  ];
}

function paint(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = y / (size - 1);
      let rgb = [lerp(18, 78, t), lerp(36, 122, t), lerp(78, 230, t)];
      const orb = Math.hypot(x - size * 0.78, y - size * 0.22) / (size * 0.34);
      if (orb < 1) rgb = mix(rgb, [255, 186, 206], (1 - orb) * 0.55);
      const sand = Math.hypot(x - size * 0.28, y - size * 0.86) / (size * 0.4);
      if (sand < 1) rgb = mix(rgb, [246, 214, 166], (1 - sand) * 0.4);
      const dx = (x - size * 0.5) / (size * 0.23);
      const dy = (y - size * 0.54) / (size * 0.23);
      const disc = Math.hypot(dx, dy);
      if (disc <= 1) {
        const rim = disc > 0.78 ? (disc - 0.78) / 0.22 : 0;
        rgb = mix(rgb, [255, 255, 255], 0.22 + rim * 0.45);
      }
      const i = (y * size + x) * 4;
      pixels[i] = Math.max(0, Math.min(255, Math.round(rgb[0])));
      pixels[i + 1] = Math.max(0, Math.min(255, Math.round(rgb[1])));
      pixels[i + 2] = Math.max(0, Math.min(255, Math.round(rgb[2])));
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

function downsample(src, from, to) {
  const dst = Buffer.alloc(to * to * 4);
  const scale = from / to;
  for (let y = 0; y < to; y += 1) {
    for (let x = 0; x < to; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x0 = Math.floor(x * scale);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      const y0 = Math.floor(y * scale);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * from + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n += 1;
        }
      }
      const o = (y * to + x) * 4;
      dst[o] = Math.round(r / n);
      dst[o + 1] = Math.round(g / n);
      dst[o + 2] = Math.round(b / n);
      dst[o + 3] = 255;
    }
  }
  return dst;
}

function png(width, height, pixels) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const start = y * (1 + width * 4);
    raw[start] = 0;
    pixels.copy(raw, start + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function write(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

const masterSize = 1024;
const master = paint(masterSize);
const sizes = [
  ["icon-1024.png", 1024],
  ["icon-60@3x.png", 180],
  ["icon-60@2x.png", 120],
  ["icon-83.5@2x.png", 167],
  ["icon-76@2x.png", 152],
  ["icon-76.png", 76],
  ["icon-40@3x.png", 120],
  ["icon-40@2x.png", 80],
  ["icon-40.png", 40],
  ["icon-29@3x.png", 87],
  ["icon-29@2x.png", 58],
  ["icon-29.png", 29],
  ["icon-20@3x.png", 60],
  ["icon-20@2x.png", 40],
  ["icon-20.png", 20],
];

for (const [name, size] of sizes) {
  const pixels = size === masterSize ? master : downsample(master, masterSize, size);
  write(join(root, "res/icon/ios", name), png(size, size, pixels));
}
write(join(root, "www/icon.png"), png(180, 180, downsample(master, masterSize, 180)));
console.log(`Wrote ${sizes.length} iOS icons and www/icon.png`);
