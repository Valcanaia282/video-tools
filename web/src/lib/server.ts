// Cliente do servidor local (server/server.mjs), que roda o yt-dlp no computador do usuário.

const KEY = 'vt-server-url'
export const DEFAULT_SERVER = 'http://127.0.0.1:5123'

export function getServerUrl(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_SERVER
  } catch {
    return DEFAULT_SERVER
  }
}

export function setServerUrl(url: string) {
  try {
    if (!url || url === DEFAULT_SERVER) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, url.replace(/\/+$/, ''))
  } catch {
    /* modo privado etc. */
  }
}

export type Health = { ok: boolean; version: string; ytdlp: string | null; ffmpeg: string | null }
export type Format = 'mp4' | 'best' | 'mp3'
export type Job = {
  id: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  phase: string
  progress: number
  detail: string
  error: string | null
  filename: string | null
  size: number | null
  log: string[]
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(getServerUrl() + path, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Erro ${res.status}`)
  return body as T
}

export async function health(signal?: AbortSignal): Promise<Health> {
  return call<Health>('/api/health', { signal, cache: 'no-store' })
}

export function createJob(input: { url: string; format: Format; start?: string; end?: string }) {
  return call<Job>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export const getJob = (id: string) => call<Job>(`/api/jobs/${id}`, { cache: 'no-store' })
export const deleteJob = (id: string) => call<{ ok: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' })
export const fileUrl = (id: string) => `${getServerUrl()}/api/jobs/${id}/file`
