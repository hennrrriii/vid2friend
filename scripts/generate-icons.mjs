/**
 * Renders public/icons/logo.svg into the PNG sizes Chrome expects.
 * Run with `npm run icons` after changing the logo. The PNGs are committed so
 * that a plain `npm install && npm run build` works without sharp being able
 * to fetch its platform binary.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const SIZES = [16, 32, 48, 128]

const svg = await readFile(here('../public/icons/logo.svg'))

for (const size of SIZES) {
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(here(`../public/icons/icon-${size}.png`), png)
  console.log(`icons: wrote icon-${size}.png (${png.length} bytes)`)
}
