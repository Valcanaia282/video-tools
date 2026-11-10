import { useEffect, useRef, useState } from 'react'
import { browserDownload, ensureWritable, safeName, uniqueName, writeFile } from '../lib/fs'
import { createJob, deleteJob, fileUrl, getJob, getServerUrl, health, type Format, type Health, type Job } from '../lib/server'
import { formatBytes, parseTime } from '../lib/time'
import { FolderField, useFolder } from './FolderField'
import { Progress } from './Progress'
import { ServerHelp } from './ServerHelp'

type Props = { onSendToGif: (file: File) => void }
type Stage = 'idle' | 'server' | 'saving' | 'done' | 'error' | 'cancelled'

const FORMATS: { value: Format; label: string }[] = [
  { value: 'mp4', label: 'Vídeo (MP4)' },
  { value: 'best', label: 'Vídeo — melhor qualidade (formato original)' },
  { value: 'mp3', label: 'Somente áudio (MP3)' },
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function DownloadTab({ onSendToGif }: Props) {
  const [srv, setSrv] = useState<Health | 'offline' | null>(null)
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState<Format>(() => (localStorage.getItem('vt-format') as Format) || 'mp4')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const { folder, choose, clear } = useFolder('download-folder')

  const [stage, setStage] = useState<Stage>('idle')
  const [job, setJob] = useState<Job | null>(null)
  const [saveProgress, setSaveProgress] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState<{ name: string; size: number; file?: File } | null>(null)
  const cancelRef = useRef<{ cancelled: boolean; jobId?: string; abort?: AbortController }>({ cancelled: false })

  const busy = stage === 'server' || stage === 'saving'
  const online = srv !== null && srv !== 'offline'

  // Verifica o servidor local de tempos em tempos.
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      try {
        const h = await health(AbortSignal.timeout(2500))
        if (!stop) setSrv(h)
      } catch {
        if (!stop) setSrv('offline')
      }
      if (!stop) timer = setTimeout(check, 5000)
    }
    check()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => localStorage.setItem('vt-format', format), [format])

  async function paste() {
    try {
      setUrl((await navigator.clipboard.readText()).trim())
    } catch {
      /* sem permissão para ler a área de transferência */
    }
  }

  async function start_() {
    if (busy) return
    const link = url.trim()
    if (!/^https?:\/\/\S+$/i.test(link)) return fail('Cole um link válido (começando com http:// ou https://).')
    const s = parseTime(start)
    const e = parseTime(end)
    if (Number.isNaN(s) || Number.isNaN(e)) return fail('Tempo inválido. Use segundos (90) ou minutos:segundos (1:30).')
    if (s !== null && e !== null && e <= s) return fail('O fim do trecho precisa ser depois do início.')
    // Pedir permissão da pasta logo no clique (o navegador exige um gesto do usuário).
    if (folder && !(await ensureWritable(folder))) return fail('Sem permissão para gravar na pasta escolhida.')

    const ctl = { cancelled: false } as typeof cancelRef.current
    cancelRef.current = ctl
    setSaved(null)
    setSaveProgress(null)
    setMessage('')
    setStage('server')

    try {
      let j = await createJob({ url: link, format, start: start.trim() || undefined, end: end.trim() || undefined })
      ctl.jobId = j.id
      setJob(j)
      while (j.status === 'running') {
        await sleep(700)
        if (ctl.cancelled) return
        j = await getJob(j.id)
        setJob(j)
      }
      if (ctl.cancelled) return
      if (j.status !== 'done' || !j.filename) throw new Error(j.error || 'Não foi possível baixar.')

      setStage('saving')
      const name = safeName(j.filename)
      if (folder) {
        ctl.abort = new AbortController()
        const res = await fetch(fileUrl(j.id), { signal: ctl.abort.signal })
        if (!res.ok || !res.body) throw new Error('Não consegui transferir o arquivo do servidor local.')
        const total = Number(res.headers.get('Content-Length')) || j.size || 0
        let received = 0
        const counter = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, c) {
            received += chunk.byteLength
            if (total) setSaveProgress((received / total) * 100)
            c.enqueue(chunk)
          },
        })
        const finalName = await uniqueName(folder, name)
        const handle = await writeFile(folder, finalName, res.body.pipeThrough(counter))
        const file = await handle.getFile()
        setSaved({ name: finalName, size: file.size, file: format === 'mp3' ? undefined : file })
        setMessage(`Salvo em “${folder.name}”.`)
        deleteJob(j.id).catch(() => {})
      } else {
        browserDownload(fileUrl(j.id), name)
        setSaved({ name, size: j.size || 0 })
        setMessage('Enviado para a pasta de downloads do navegador.')
      }
      setStage('done')
    } catch (err) {
      if (ctl.cancelled) return
      fail(err instanceof Error ? err.message : String(err))
      if (ctl.jobId) deleteJob(ctl.jobId).catch(() => {})
    }
  }

  function fail(msg: string) {
    setStage('error')
    setMessage(msg)
  }

  async function cancel() {
    const ctl = cancelRef.current
    ctl.cancelled = true
    ctl.abort?.abort()
    if (ctl.jobId) deleteJob(ctl.jobId).catch(() => {})
    setStage('cancelled')
    setMessage('Download cancelado.')
  }

  const progressValue =
    stage === 'saving'
      ? saveProgress
      : job && job.phase === 'Baixando…' && job.progress > 0
        ? job.progress
        : null
  const progressLabel = stage === 'saving' ? (folder ? 'Salvando na pasta…' : 'Enviando para o navegador…') : job?.phase || 'Conectando…'

  return (
    <section className="panel">
      <div className="server-status">
        <span className={'dot ' + (srv === null ? 'wait' : online ? 'on' : 'off')} />
        {srv === null && 'Procurando o servidor local…'}
        {online && (
          <span>
            Servidor local conectado · yt-dlp {(srv as Health).ytdlp ?? <b className="warn">não encontrado</b>} · ffmpeg{' '}
            {(srv as Health).ffmpeg ? 'ok' : <b className="warn">não encontrado</b>}
          </span>
        )}
        {srv === 'offline' && <span>Servidor local desconectado ({getServerUrl()})</span>}
      </div>

      {srv === 'offline' && <ServerHelp />}

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          start_()
        }}
      >
        <label className="field">
          <span className="label">Link do vídeo</span>
          <div className="row">
            <input
              type="url"
              inputMode="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              className="grow"
              autoComplete="off"
            />
            <button type="button" onClick={paste} disabled={busy}>
              Colar
            </button>
          </div>
        </label>

        <div className="grid-2">
          <label className="field">
            <span className="label">Formato</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as Format)} disabled={busy}>
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span className="label">Baixar só um trecho (opcional)</span>
            <div className="row">
              <input className="time" placeholder="início" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
              <span className="muted">até</span>
              <input className="time" placeholder="fim" value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
              <span className="hint">ex.: 1:30</span>
            </div>
          </div>
        </div>

        <FolderField
          label="Salvar em"
          folder={folder}
          onChoose={choose}
          onClear={clear}
          fallback="Pasta de downloads do navegador"
          disabled={busy}
        />

        <div className="actions">
          {busy ? (
            <button type="button" className="danger" onClick={cancel}>
              Cancelar
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!online}>
              Baixar
            </button>
          )}
          {!online && srv !== null && <span className="hint">Inicie o servidor local para baixar.</span>}
        </div>
      </form>

      {busy && <Progress value={progressValue} label={progressLabel} detail={stage === 'server' ? job?.detail : undefined} />}

      {stage === 'done' && saved && (
        <div className="notice ok">
          <div>
            <strong>{saved.name}</strong> <span className="muted">· {formatBytes(saved.size)}</span>
            <div className="muted">{message}</div>
          </div>
          {saved.file && (
            <button type="button" onClick={() => onSendToGif(saved.file!)}>
              Transformar em GIFs →
            </button>
          )}
        </div>
      )}
      {(stage === 'error' || stage === 'cancelled') && message && (
        <div className={'notice ' + (stage === 'error' ? 'err' : '')}>
          <div>
            {message}
            {stage === 'error' && job?.log?.length ? (
              <details>
                <summary>Ver detalhes</summary>
                <pre>{job.log.join('\n')}</pre>
              </details>
            ) : null}
            {stage === 'error' && /unsupported url|unable to extract|sign in|http error 4\d\d/i.test(message) && (
              <p className="hint">
                Se o site funcionava antes, atualize o yt-dlp: <code>winget upgrade yt-dlp.yt-dlp</code> (ou <code>yt-dlp -U</code>)
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
