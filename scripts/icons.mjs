import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

export const iconSizes = [16, 32, 48, 128, 256, 512, 1024];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

// An opaque app icon: a light git branch with green endpoints on deep navy.
// Render at four samples per axis so the smaller extension icons stay smooth.
function renderIcon(size) {
  const pixels = Buffer.alloc(size * (1 + size * 3));
  const background = [15, 23, 42];
  const foreground = [241, 245, 249];
  const green = [74, 222, 128];
  const distance = (x, y, ax, ay, bx, by) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
  };
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const total = [0, 0, 0];
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const x = (col + (sx + 0.5) / 4) / size;
          const y = (row + (sy + 0.5) / 4) / size;
          let color = background;
          if (distance(x, y, 0.35, 0.29, 0.35, 0.72) < 0.035 ||
              distance(x, y, 0.35, 0.60, 0.65, 0.40) < 0.035 ||
              distance(x, y, 0.65, 0.40, 0.65, 0.29) < 0.035) color = foreground;
          for (const [cx, cy] of [[0.35, 0.27], [0.65, 0.27], [0.35, 0.73]]) {
            const radius = Math.hypot(x - cx, y - cy);
            if (radius < 0.10) color = green;
            if (radius < 0.045) color = background;
          }
          for (let channel = 0; channel < 3; channel++) total[channel] += color[channel];
        }
      }
      const offset = row * (1 + size * 3) + 1 + col * 3;
      for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(total[channel] / 16);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // Eight bits per channel.
  header[9] = 2; // RGB, without alpha (also suitable for the iOS app icon).
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function writeIcons(outdir) {
  await mkdir(`${outdir}/icons`, { recursive: true });
  for (const size of iconSizes) await writeFile(`${outdir}/icons/icon-${size}.png`, renderIcon(size));
}
