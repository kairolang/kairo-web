/**
 * generate-icons.mjs - rasterize the Kairo logo into the PNG/ICO icons that
 * crawlers, iOS and the web app manifest need (they don't use SVG).
 *
 *   node generate-icons.mjs        (or: bun generate-icons.mjs)
 *
 * Outputs into public/: apple-touch-icon.png (180), icon-192.png, icon-512.png,
 * icon-maskable-512.png, favicon.ico (16/32/48, PNG-in-ICO).
 * Re-run only when the logo SVGs change; the outputs are committed.
 */
import fs from 'node:fs';
import sharp from 'sharp';

const BG = '#08080a';
const LOGO = 'public/kairo-logo.svg';
const TAB = 'public/kairo-file-icon.svg'; // the browser-tab icon (kept consistent for favicon.ico)

async function icon(src, size, pad) {
  const inner = Math.round(size * (1 - pad * 2));
  const art = await sharp(src, { density: 1200 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: art, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** ICO container holding PNG images (supported by every current browser). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...pngs.map(p => p.data)]);
}

const out = {
  'public/apple-touch-icon.png': await icon(LOGO, 180, 0.14),
  'public/icon-192.png': await icon(LOGO, 192, 0.12),
  'public/icon-512.png': await icon(LOGO, 512, 0.12),
  'public/icon-maskable-512.png': await icon(LOGO, 512, 0.22),
  'public/favicon.ico': ico(
    await Promise.all([16, 32, 48].map(async size => ({ size, data: await icon(TAB, size, 0.04) })))
  ),
};
for (const [file, data] of Object.entries(out)) {
  fs.writeFileSync(file, data);
  console.log(`${file}  ${data.length} bytes`);
}
