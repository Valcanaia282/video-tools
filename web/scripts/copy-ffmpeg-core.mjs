// Antes do build/dev:
//  1. copia o núcleo do ffmpeg.wasm para public/ffmpeg (o site não depende de CDN);
//  2. empacota o servidor local em public/video-tools-servidor.zip (download direto pelo site).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { zipSync } from 'fflate'

const pub = new URL('../public/', import.meta.url)

const core = new URL('../node_modules/@ffmpeg/core/dist/esm/', import.meta.url)
mkdirSync(new URL('ffmpeg/', pub), { recursive: true })
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(new URL(f, core), new URL(`ffmpeg/${f}`, pub))

const server = new URL('../../server/', import.meta.url)
const files = {}
for (const f of ['server.mjs', 'iniciar-servidor.bat', 'package.json', 'LEIA-ME.txt']) {
  files[`video-tools-servidor/${f}`] = new Uint8Array(readFileSync(new URL(f, server)))
}
writeFileSync(new URL('video-tools-servidor.zip', pub), zipSync(files, { level: 9 }))
console.log('ffmpeg core + video-tools-servidor.zip prontos em public/')
