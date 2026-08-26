/**
 * Packs dist/ into vid2friend-<version>.zip for the Chrome Web Store.
 *
 * This writes the ZIP by hand instead of shelling out, for one specific reason:
 * PowerShell's Compress-Archive stores paths with BACKSLASHES. The ZIP format
 * requires forward slashes, and an archive built that way either gets rejected
 * on upload or unpacks into files literally named `assets\chunk-abc.js`. That is
 * a genuinely nasty half hour to debug, so we sidestep it.
 *
 * The archive contains the *contents* of dist, so manifest.json sits at the
 * root. That is the other classic upload rejection.
 */
import { deflateRawSync } from 'node:zlib'
import { existsSync, rmSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = `${root}dist`

if (!existsSync(`${dist}/manifest.json`)) {
  console.error('zip: dist/manifest.json is missing. Run `npm run build` first.')
  process.exit(1)
}

const pkg = JSON.parse(await readFile(`${root}package.json`, 'utf8'))
const target = `${root}vid2friend-${pkg.version}.zip`
if (existsSync(target)) rmSync(target)

// --- collect every file under dist, with forward-slashed relative names ----
async function collect(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await collect(`${dir}/${entry.name}`, name)))
    else files.push({ name, data: await readFile(`${dir}/${entry.name}`) })
  }
  return files
}

const files = await collect(dist)

// --- CRC32, table generated once ------------------------------------------
const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

// A fixed timestamp keeps the archive byte-identical across builds of the same
// code, which makes it obvious when something actually changed.
const DOS_TIME = 0
const DOS_DATE = (2020 - 1980) * 512 + 1 * 32 + 1

const localParts = []
const centralParts = []
let offset = 0

for (const file of files) {
  const nameBytes = Buffer.from(file.name, 'utf8')
  const compressed = deflateRawSync(file.data, { level: 9 })
  const crc = crc32(file.data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0) // local file header signature
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0x0800, 6) // flags: UTF-8 file names
  local.writeUInt16LE(8, 8) // method: deflate
  local.writeUInt16LE(DOS_TIME, 10)
  local.writeUInt16LE(DOS_DATE, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(file.data.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  local.writeUInt16LE(0, 28) // extra field length

  localParts.push(local, nameBytes, compressed)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0) // central directory header signature
  central.writeUInt16LE(20, 4) // version made by
  central.writeUInt16LE(20, 6) // version needed
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(8, 10)
  central.writeUInt16LE(DOS_TIME, 12)
  central.writeUInt16LE(DOS_DATE, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(file.data.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt16LE(0, 30) // extra
  central.writeUInt16LE(0, 32) // comment
  central.writeUInt16LE(0, 34) // disk number
  central.writeUInt16LE(0, 36) // internal attributes
  central.writeUInt32LE(0, 38) // external attributes
  central.writeUInt32LE(offset, 42)

  centralParts.push(central, nameBytes)
  offset += local.length + nameBytes.length + compressed.length
}

const centralDirectory = Buffer.concat(centralParts)

const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0) // end of central directory signature
end.writeUInt16LE(0, 4) // this disk
end.writeUInt16LE(0, 6) // disk with central directory
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralDirectory.length, 12)
end.writeUInt32LE(offset, 16)
end.writeUInt16LE(0, 20) // comment length

await writeFile(target, Buffer.concat([...localParts, centralDirectory, end]))

console.log(`zip: wrote ${target} (${files.length} files)`)
console.log('Upload it at https://chrome.google.com/webstore/devconsole')
