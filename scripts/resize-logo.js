const sharp = require('sharp');
const path = require('path');

const SOURCE = path.join(__dirname, '..', '..', '..', 'Downloads', 'ChatGPT Image Mar 17, 2026, 10_48_41 PM.png');
const PUBLIC = path.join(__dirname, '..', 'public');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function generate() {
  // Trim white space around the logo, then resize
  const trimmed = sharp(SOURCE).trim();
  const trimmedBuf = await trimmed.toBuffer();

  for (const size of sizes) {
    await sharp(trimmedBuf)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(PUBLIC, `icon-${size}x${size}.png`));
    console.log(`Generated icon-${size}x${size}.png`);
  }

  // Apple touch icon (180x180) - needs solid background for iOS
  await sharp(trimmedBuf)
    .resize(180, 180, { fit: 'contain', background: { r: 11, g: 17, b: 32, alpha: 1 } })
    .flatten({ background: { r: 11, g: 17, b: 32 } })
    .png()
    .toFile(path.join(PUBLIC, 'apple-touch-icon.png'));
  console.log('Generated apple-touch-icon.png');

  // Favicon (32x32)
  await sharp(trimmedBuf)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(PUBLIC, 'favicon.png'));
  console.log('Generated favicon.png');

  // Full logo
  await sharp(trimmedBuf)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(PUBLIC, 'logo.png'));
  console.log('Generated logo.png');

  console.log('\nAll icons generated from logo!');
}

generate().catch(console.error);
