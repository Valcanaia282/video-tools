// FFmpeg rodando dentro do navegador (WebAssembly). Nada é enviado para servidor nenhum.
import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'
import { fileTime, parseTime } from './time'
import { safeName, splitExt } from './fs'

let instance: FFmpeg | null = null
let loading: Promise<FFmpeg> | null = null

export function ffmpegLoaded() {
  return instance !== null
}

/**
 * Baixa um arquivo como blob: URL informando o progresso.
 * (O toBlobURL do @ffmpeg/util quebra quando o servidor comprime a resposta, como o GitHub Pages
 * faz com o .wasm: o Content-Length é do arquivo comprimido e nunca bate com os bytes recebidos.)
 */
async function blobUrlWithProgress(url: string, type: string, onProgress: (pct: number | null, bytes: number) => void) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Falha ao baixar ${url} (${res.status})`)
  const encoded = !!res.headers.get('Content-Encoding')
  const total = encoded ? 0 : Number(res.headers.get('Content-Length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress(total ? Math.min(100, (received / total) * 100) : null, received)
  }
  return URL.createObjectURL(new Blob(chunks as BlobPart[], { type }))
}

/** Carrega o FFmpeg uma única vez (~31 MB; o navegador guarda em cache depois). */
export function getFFmpeg(onDownload?: (pct: number | null, bytes: number) => void): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance)
  if (!loading) {
    loading = (async () => {
      const ff = new FFmpeg()
      const base = new URL(import.meta.env.BASE_URL + 'ffmpeg/', location.href).href
      const coreURL = await toBlobURL(base + 'ffmpeg-core.js', 'text/javascript')
      const wasmURL = await blobUrlWithProgress(base + 'ffmpeg-core.wasm', 'application/wasm', (pct, bytes) =>
        onDownload?.(pct, bytes),
      )
      await ff.load({ coreURL, wasmURL })
      instance = ff
      return ff
    })().catch((err) => {
      loading = null
      throw err
    })
  }
  return loading
}

/** Interrompe o que estiver rodando (o próximo uso recarrega o FFmpeg). */
export function killFFmpeg() {
  instance?.terminate()
  instance = null
  loading = null
}

// ------------------------------------------------ entrada
const IN_DIR = '/input'

async function mountInput(ff: FFmpeg, file: File): Promise<{ path: string; cleanup: () => Promise<void> }> {
  try {
    await ff.createDir(IN_DIR)
  } catch {
    /* já existe */
  }
  try {
    // WORKERFS lê direto do arquivo, sem copiar o vídeo inteiro para a memória.
    await ff.mount(FFFSType.WORKERFS, { files: [file] }, IN_DIR)
    return { path: `${IN_DIR}/${file.name}`, cleanup: async () => void (await ff.unmount(IN_DIR).catch(() => {})) }
  } catch {
    const p = '/input-file' + splitExt(file.name)[1]
    await ff.writeFile(p, new Uint8Array(await file.arrayBuffer()))
    return { path: p, cleanup: async () => void (await ff.deleteFile(p).catch(() => {})) }
  }
}

/** Duração via FFmpeg (para formatos que o <video> do navegador não abre, ex.: .avi). */
export async function probeDuration(file: File): Promise<number | null> {
  const ff = await getFFmpeg()
  const input = await mountInput(ff, file)
  let duration: number | null = null
  const onLog = ({ message }: { message: string }) => {
    const m = message.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/)
    if (m) duration = parseTime(m[1])
  }
  ff.on('log', onLog)
  try {
    await ff.exec(['-hide_banner', '-i', input.path])
  } finally {
    ff.off('log', onLog)
    await input.cleanup()
  }
  return duration
}

// ------------------------------------------------ conversão
export type Mode = 'split' | 'single' | 'frames'
export type ConvertOptions = {
  mode: Mode
  start: number
  end: number
  seg: number
  fps: number | null
  width: number | null
}
export type Output = { name: string; data: Uint8Array }

function gifFilter(pre: string[]) {
  const head = pre.join(',')
  return (
    (head ? head + ',' : '') +
    'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
  )
}

export function countOutputs(o: Pick<ConvertOptions, 'mode' | 'start' | 'end' | 'seg'>) {
  if (o.mode !== 'split') return 1
  return Math.max(1, Math.ceil((o.end - o.start) / o.seg - 1e-6))
}

/**
 * Converte o vídeo. Cada arquivo gerado é entregue em onOutput assim que fica pronto
 * (e apagado da memória do FFmpeg logo em seguida).
 */
export async function convert(
  file: File,
  opts: ConvertOptions,
  onOutput: (o: Output) => Promise<void>,
  onProgress: (pct: number, label: string) => void,
): Promise<number> {
  const ff = await getFFmpeg()
  const input = await mountInput(ff, file)
  const stem = safeName(splitExt(file.name)[0])
  const pre: string[] = []
  if (opts.fps) pre.push(`fps=${opts.fps}`)
  if (opts.width) pre.push(`scale=${opts.width}:-2:flags=lanczos`)

  // Progresso: lê o "time=" que o FFmpeg escreve no log.
  let span = 1
  let base = 0
  let share = 100
  const onLog = ({ message }: { message: string }) => {
    const m = message.match(/time=\s*(\d+:\d+:\d+(?:\.\d+)?)/)
    if (!m) return
    const t = parseTime(m[1]) ?? 0
    onProgress(base + share * Math.min(1, t / span), '')
  }
  ff.on('log', onLog)

  const run = async (args: string[]) => {
    const code = await ff.exec(['-hide_banner', '-y', ...args])
    if (code !== 0) throw new Error(`O FFmpeg falhou (código ${code}). O arquivo é um vídeo válido?`)
  }
  const take = async (path: string, name: string) => {
    const data = (await ff.readFile(path)) as Uint8Array
    await ff.deleteFile(path).catch(() => {})
    await onOutput({ name, data })
  }

  let made = 0
  try {
    const length = opts.end - opts.start
    if (opts.mode === 'split') {
      const n = countOutputs(opts)
      const digits = Math.max(3, String(n).length)
      for (let i = 0; i < n; i++) {
        const ss = opts.start + i * opts.seg
        const t = Math.min(opts.seg, opts.end - ss)
        if (t < 0.05) break
        span = t
        base = (i / n) * 100
        share = 100 / n
        onProgress(base, `Gerando GIF ${i + 1} de ${n}…`)
        const name = `${stem}_${String(i + 1).padStart(digits, '0')}.gif`
        await run(['-ss', ss.toFixed(3), '-t', t.toFixed(3), '-i', input.path, '-vf', gifFilter(pre), '-loop', '0', '/out.gif'])
        await take('/out.gif', name)
        made++
      }
    } else if (opts.mode === 'single') {
      span = length
      onProgress(0, 'Gerando GIF…')
      const name = `${stem}_${fileTime(opts.start)}-${fileTime(opts.end)}.gif`
      await run(['-ss', opts.start.toFixed(3), '-t', length.toFixed(3), '-i', input.path, '-vf', gifFilter(pre), '-loop', '0', '/out.gif'])
      await take('/out.gif', name)
      made = 1
    } else {
      span = length
      onProgress(0, 'Extraindo imagens…')
      try {
        await ff.createDir('/frames')
      } catch {
        /* já existe */
      }
      const args = ['-ss', opts.start.toFixed(3), '-t', length.toFixed(3), '-i', input.path]
      if (pre.length) args.push('-vf', pre.join(','))
      await run([...args, '/frames/f_%05d.png'])
      ff.off('log', onLog)
      const files = (await ff.listDir('/frames')).filter((f) => !f.isDir && f.name.endsWith('.png'))
      files.sort((a, b) => a.name.localeCompare(b.name))
      for (let i = 0; i < files.length; i++) {
        onProgress((i / files.length) * 100, `Salvando imagem ${i + 1} de ${files.length}…`)
        await take(`/frames/${files[i].name}`, `${stem}_${files[i].name.slice(2)}`)
        made++
      }
    }
  } finally {
    ff.off('log', onLog)
    await input.cleanup()
  }
  onProgress(100, '')
  return made
}
