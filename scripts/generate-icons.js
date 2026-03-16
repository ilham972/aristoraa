const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const combined = Buffer.concat([typeBuffer, data]);
  const crcVal = crc32(combined);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuffer, data, crcBuf]);
}

function createIcon(size, bgR, bgG, bgB) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Create pixel data with rounded rectangle + "A" letter
  const rawData = Buffer.alloc(size * (1 + size * 4));
  const radius = Math.floor(size * 0.18);

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + size * 4);
    rawData[rowOffset] = 0; // no filter

    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      const inRoundedRect = isInRoundedRect(x, y, size, size, radius);

      if (inRoundedRect) {
        // Check if pixel is part of the "A" letter
        const isLetter = isInLetterA(x, y, size);
        if (isLetter) {
          // White letter
          rawData[px] = 255;
          rawData[px + 1] = 255;
          rawData[px + 2] = 255;
          rawData[px + 3] = 255;
        } else {
          // Teal background
          rawData[px] = bgR;
          rawData[px + 1] = bgG;
          rawData[px + 2] = bgB;
          rawData[px + 3] = 255;
        }
      } else {
        // Transparent
        rawData[px] = 0;
        rawData[px + 1] = 0;
        rawData[px + 2] = 0;
        rawData[px + 3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function isInRoundedRect(x, y, w, h, r) {
  if (x < r && y < r) return dist(x, y, r, r) <= r;
  if (x >= w - r && y < r) return dist(x, y, w - r - 1, r) <= r;
  if (x < r && y >= h - r) return dist(x, y, r, h - r - 1) <= r;
  if (x >= w - r && y >= h - r) return dist(x, y, w - r - 1, h - r - 1) <= r;
  return true;
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function isInLetterA(x, y, size) {
  const cx = size / 2;
  const top = size * 0.2;
  const bottom = size * 0.8;
  const halfWidth = size * 0.25;
  const thickness = size * 0.08;

  // Normalize position
  const progress = (y - top) / (bottom - top);
  if (progress < 0 || progress > 1) return false;

  // Left leg
  const leftCenter = cx - halfWidth * progress;
  if (Math.abs(x - leftCenter) < thickness) return true;

  // Right leg
  const rightCenter = cx + halfWidth * progress;
  if (Math.abs(x - rightCenter) < thickness) return true;

  // Crossbar (at ~55% height)
  if (progress > 0.5 && progress < 0.6) {
    if (x > leftCenter - thickness && x < rightCenter + thickness) return true;
  }

  return false;
}

// Generate icons
const publicDir = path.join(__dirname, '..', 'public');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

sizes.forEach(size => {
  const png = createIcon(size, 13, 148, 136); // #0D9488 teal
  fs.writeFileSync(path.join(publicDir, `icon-${size}x${size}.png`), png);
  console.log(`Generated icon-${size}x${size}.png`);
});

// Also create apple-touch-icon (180x180)
const applePng = createIcon(180, 13, 148, 136);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), applePng);
console.log('Generated apple-touch-icon.png');

console.log('All icons generated!');
