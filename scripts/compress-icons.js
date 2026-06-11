// One-off: recompress the public/ PNG icons in place with palette
// quantization. The originals were full 32-bit PNGs (icon-512 + logo were
// 510KB each); palette PNGs render identically for a flat-color logo at a
// fraction of the size. Run: node scripts/compress-icons.js
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

async function compress() {
  const files = fs
    .readdirSync(PUBLIC)
    .filter((f) => f.endsWith('.png'));

  for (const f of files) {
    const full = path.join(PUBLIC, f);
    const before = fs.statSync(full).size;
    const buf = await sharp(full)
      .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
      .toBuffer();
    // Only keep the result when it actually shrinks the file.
    if (buf.length < before) {
      fs.writeFileSync(full, buf);
    }
    const after = fs.statSync(full).size;
    console.log(
      `${f}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`
    );
  }
}

compress().catch((e) => {
  console.error(e);
  process.exit(1);
});
