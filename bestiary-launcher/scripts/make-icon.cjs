const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

(async () => {
  const root = path.resolve(__dirname, '..');
  const svg = path.join(root, 'resources', 'icon-source.svg');
  const build = path.join(root, 'build');
  fs.mkdirSync(build, { recursive: true });
  const pngs = [];
  for (const size of [256, 128, 64, 48, 32, 16]) {
    const out = path.join(build, `icon-${size}.png`);
    await sharp(svg).resize(size, size).png().toFile(out);
    pngs.push(out);
  }
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(build, 'icon.ico'), ico);
  await sharp(svg).resize(640, 360, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(root, 'resources', 'logo.png'));
})().catch((error) => { console.error(error); process.exit(1); });
