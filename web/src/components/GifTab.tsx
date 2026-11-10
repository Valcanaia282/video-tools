import { zipSync } from 'fflate'
import { useEffect, useRef, useState } from 'react'
import { convert, countOutputs, ffmpegLoaded, getFFmpeg, killFFmpeg, probeDuration, type Mode } from '../lib/ffmpeg'
import { browserDownload, ensureWritable, safeName, splitExt, writeFile } from '../lib/fs'
import { formatBytes, formatTime, parseTime } from '../lib/time'
import { FolderField, useFolder } from './FolderField'
import { Progress } from './Progress'

type Props = { active: boolean; incoming: File | null }
type Preview = { name: string; url: string; size: number }

const FPS = ['original', '5', '8', '10', '12', '15', '20', '24', '30']
const WIDTHS = ['original', '240', '320', '480', '640', '720', '1080']
const MAX_PREVIEWS = 60

const MODES: { value: Mode; title: string; desc: string }[] = [
  { value: 'split', title: 'Vários GIFs', desc: 'Divide o vídeo em partes de N segundos' },
  { value: 'single', title: 'Um GIF', desc: 'Do vídeo inteiro ou do trecho marcado' },
  { value: 'frames', title: 'Imagens PNG', desc: 'Extrai os quadros do vídeo' },
]

function saved<T extends string>(key: string, def: T): T {
  try {
    return (localStorage.getItem(key) as T) || def
  } catch {
    return def
  }
}

export function GifTab({ active, incoming }: Props) {
  const [ff, setFf] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; pct: number }>({
    state: ffmpegLoaded() ? 'ready' : 'idle',
    pct: 0,
  })
  const [file, setFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [playable, setPlayable] = useState(true)
  const [mode, setMode] = useState<Mode>(saved('vt-mode', 'split'))
  const [seg, setSeg] = useState<string>(saved('vt-seg', '3'))
  const [fps, setFps] = useState<string>(saved('vt-fps', '12'))
  const [width, setWidth] = useState<string>(saved('vt-width', '480'))
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const { folder, choose, clear } = useFolder('gif-folder')

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [label, setLabel] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [previews, setPreviews] = useState<Preview[]>([])
  const [dragging, setDragging] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cancelled = useRef(false)

  // Carrega o FFmpeg na primeira vez que a aba é aberta.
  useEffect(() => {
    if (!active || ff.state !== 'idle') return
    setFf({ state: 'loading', pct: 0 })
    getFFmpeg((pct) => setFf({ state: 'loading', pct }))
      .then(() => setFf({ state: 'ready', pct: 100 }))
      .catch(() => setFf({ state: 'error', pct: 0 }))
  }, [active, ff.state])

  useEffect(() => {
    if (incoming) selectFile(incoming)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming])

  useEffect(() => {
    for (const [k, v] of [['vt-mode', mode], ['vt-seg', seg], ['vt-fps', fps], ['vt-width', width]]) {
      try {
        localStorage.setItem(k, v)
      } catch {
        /* ignore */
      }
    }
  }, [mode, seg, fps, width])

  function clearPreviews() {
    setPreviews((old) => {
      old.forEach((p) => URL.revokeObjectURL(p.url))
      return []
    })
  }

  function selectFile(f: File) {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setFile(f)
    setVideoUrl(URL.createObjectURL(f))
    setDuration(null)
    setPlayable(true)
    setStart('')
    setEnd('')
    setResult(null)
    clearPreviews()
  }

  async function onVideoError() {
    // O navegador não toca esse formato (ex.: .avi, .mkv com certos codecs): pega a duração pelo FFmpeg.
    setPlayable(false)
    if (!file) return
    try {
      setDuration(await probeDuration(file))
    } catch {
      setDuration(null)
    }
  }

  function markTime(which: 'start' | 'end') {
    const t = videoRef.current?.currentTime
    if (t === undefined) return
    const v = formatTime(t, 1)
    if (which === 'start') setStart(v)
    else setEnd(v)
  }

  async function run() {
    if (!file || running) return
    setResult(null)
    const s = parseTime(start) ?? 0
    let e = parseTime(end)
    const segN = Number(seg.replace(',', '.'))
    const fpsN = fps === 'original' ? null : Number(fps.replace(',', '.'))
    const widthN = width === 'original' ? null : parseInt(width, 10)
    if (Number.isNaN(s) || Number.isNaN(e)) return setResult({ ok: false, text: 'Tempo inválido. Use segundos (90) ou minutos:segundos (1:30).' })
    if (!(segN > 0) || (fpsN !== null && !(fpsN > 0)) || (widthN !== null && !(widthN >= 16)))
      return setResult({ ok: false, text: 'Confira as opções: duração, quadros por segundo e largura precisam ser números positivos.' })
    const total = duration ?? e
    if (total == null) return setResult({ ok: false, text: 'Não consegui descobrir a duração do vídeo. Preencha o fim do trecho.' })
    e = e === null ? total : Math.min(e, total)
    if (s >= e) return setResult({ ok: false, text: `Trecho inválido. O vídeo tem ${formatTime(total, 0)}.` })

    const opts = { mode, start: s, end: e, seg: segN, fps: fpsN, width: widthN }
    const n = countOutputs(opts)
    if (mode === 'split' && n > 150 && !confirm(`Isso vai gerar ${n} GIFs. Continuar?`)) return
    if (mode === 'single' && e - s > 60 && !confirm('GIFs com mais de 1 minuto ficam muito pesados. Continuar?')) return
    if (folder && !(await ensureWritable(folder))) return setResult({ ok: false, text: 'Sem permissão para gravar na pasta escolhida.' })

    // Destino: subpasta "<nome do vídeo>_gifs" dentro da pasta escolhida, ou zip/download.
    const stem = safeName(splitExt(file.name)[0])
    const subName = `${stem}_${mode === 'frames' ? 'frames' : 'gifs'}`
    const target = folder ? await folder.getDirectoryHandle(subName, { create: true }) : null
    const zipFiles: Record<string, Uint8Array> = {}
    let bytes = 0

    cancelled.current = false
    clearPreviews()
    setRunning(true)
    setProgress(0)
    setLabel('Preparando…')
    try {
      const made = await convert(
        file,
        opts,
        async ({ name, data }) => {
          bytes += data.byteLength
          if (target) await writeFile(target, name, data)
          else zipFiles[name] = data
          setPreviews((old) =>
            old.length >= MAX_PREVIEWS
              ? old
              : [...old, { name, size: data.byteLength, url: URL.createObjectURL(new Blob([data as BlobPart], { type: name.endsWith('.gif') ? 'image/gif' : 'image/png' })) }],
          )
        },
        (pct, text) => {
          setProgress(pct)
          if (text) setLabel(text)
        },
      )
      const what = mode === 'frames' ? `${made} imagem(ns)` : `${made} GIF${made === 1 ? '' : 's'}`
      if (target) {
        setResult({ ok: true, text: `Pronto! ${what} (${formatBytes(bytes)}) salvos em “${folder!.name}/${subName}”.` })
      } else {
        const names = Object.keys(zipFiles)
        if (names.length === 1) browserDownload(new Blob([zipFiles[names[0]] as BlobPart]), names[0])
        else if (names.length > 1) browserDownload(new Blob([zipSync(zipFiles, { level: 0 }) as BlobPart], { type: 'application/zip' }), `${subName}.zip`)
        setResult({ ok: true, text: `Pronto! ${what} (${formatBytes(bytes)}) enviados para a pasta de downloads${names.length > 1 ? ' em um .zip' : ''}.` })
      }
    } catch (err) {
      if (cancelled.current) setResult({ ok: false, text: 'Cancelado.' })
      else setResult({ ok: false, text: err instanceof Error ? err.message : String(err) })
    } finally {
      setRunning(false)
      setLabel('')
    }
  }

  function cancel() {
    cancelled.current = true
    killFFmpeg()
    setFf({ state: 'idle', pct: 0 }) // recarrega na próxima vez
  }

  const segN = Number(seg.replace(',', '.'))
  const sN = parseTime(start) ?? 0
  const eN = parseTime(end) ?? duration ?? 0
  const estimate = mode === 'split' && duration && segN > 0 && eN > sN ? countOutputs({ mode, start: sN, end: Math.min(eN, duration), seg: segN }) : null

  return (
    <section className="panel">
      {ff.state === 'loading' && <Progress value={ff.pct || null} label="Carregando o FFmpeg (só na primeira vez, ~31 MB)…" />}
      {ff.state === 'error' && (
        <div className="notice err">
          Não consegui carregar o FFmpeg. Verifique a conexão e recarregue a página.
        </div>
      )}

      <div
        className={'drop' + (dragging ? ' over' : '') + (file ? ' has-file' : '')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files[0]
          if (f) selectFile(f)
        }}
      >
        {file && videoUrl ? (
          <div className="video-box">
            {playable ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                preload="metadata"
                onLoadedMetadata={(e) => setDuration(isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null)}
                onError={onVideoError}
              />
            ) : (
              <div className="no-preview">Pré-visualização indisponível para esse formato, mas a conversão funciona.</div>
            )}
            <div className="file-line">
              <span className="file-name" title={file.name}>
                {file.name}
              </span>
              <span className="muted">
                {formatBytes(file.size)}
                {duration ? ` · ${formatTime(duration, 1)}` : ''}
              </span>
              <label className="link-btn">
                Trocar vídeo
                <input type="file" accept="video/*,.mkv,.avi,.flv,.wmv,.ts,.gif" hidden onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])} />
              </label>
            </div>
          </div>
        ) : (
          <label className="drop-empty">
            <strong>Arraste um vídeo para cá</strong>
            <span className="muted">ou clique para escolher · o vídeo não sai do seu computador</span>
            <input type="file" accept="video/*,.mkv,.avi,.flv,.wmv,.ts,.gif" hidden onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])} />
          </label>
        )}
      </div>

      <div className="modes" role="radiogroup" aria-label="O que gerar">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            className={'mode' + (mode === m.value ? ' selected' : '')}
            onClick={() => setMode(m.value)}
            disabled={running}
          >
            <strong>{m.title}</strong>
            <span>{m.desc}</span>
          </button>
        ))}
      </div>

      <div className="options">
        {mode === 'split' && (
          <label className="field">
            <span className="label">Duração de cada GIF (s)</span>
            <input type="number" min="0.5" step="0.5" value={seg} onChange={(e) => setSeg(e.target.value)} disabled={running} />
          </label>
        )}
        <label className="field">
          <span className="label">Quadros por segundo</span>
          <select value={fps} onChange={(e) => setFps(e.target.value)} disabled={running}>
            {FPS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Largura (px)</span>
          <select value={width} onChange={(e) => setWidth(e.target.value)} disabled={running}>
            {WIDTHS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="label">Trecho (opcional)</span>
          <div className="row">
            <input className="time" placeholder="início" value={start} onChange={(e) => setStart(e.target.value)} disabled={running} />
            {playable && file && (
              <button type="button" className="ghost small" onClick={() => markTime('start')} disabled={running} title="Usar o tempo atual do vídeo">
                agora
              </button>
            )}
            <span className="muted">até</span>
            <input className="time" placeholder="fim" value={end} onChange={(e) => setEnd(e.target.value)} disabled={running} />
            {playable && file && (
              <button type="button" className="ghost small" onClick={() => markTime('end')} disabled={running} title="Usar o tempo atual do vídeo">
                agora
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="hint">
        GIFs mais leves: menos quadros por segundo e largura menor. “agora” usa o ponto em que o vídeo está pausado.
        {estimate ? ` Serão gerados ${estimate} GIF${estimate === 1 ? '' : 's'}.` : ''}
      </p>

      <FolderField
        label="Salvar em"
        folder={folder}
        onChoose={choose}
        onClear={clear}
        fallback="Pasta de downloads do navegador (.zip)"
        disabled={running}
      />

      <div className="actions">
        {running ? (
          <button type="button" className="danger" onClick={cancel}>
            Cancelar
          </button>
        ) : (
          <button type="button" className="primary" onClick={run} disabled={!file || ff.state !== 'ready'}>
            {mode === 'frames' ? 'Extrair imagens' : 'Gerar GIFs'}
          </button>
        )}
        {!file && <span className="hint">Escolha um vídeo primeiro.</span>}
      </div>

      {running && <Progress value={progress} label={label} />}
      {result && <div className={'notice ' + (result.ok ? 'ok' : 'err')}>{result.text}</div>}

      {previews.length > 0 && (
        <div className="previews">
          {previews.map((p) => (
            <figure key={p.url}>
              <a href={p.url} download={p.name} title={`Baixar ${p.name}`}>
                <img src={p.url} alt={p.name} loading="lazy" />
              </a>
              <figcaption>
                <span>{p.name}</span>
                <span className="muted">{formatBytes(p.size)}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  )
}
