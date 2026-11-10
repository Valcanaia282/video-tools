/** '90', '1:30', '0:01:30', '12,5' -> segundos. Vazio -> null. Inválido -> NaN. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  const parts = t.split(':')
  if (parts.length > 3 || parts.some((p) => p.trim() === '' || isNaN(Number(p)))) return NaN
  const secs = parts.reduce((acc, p) => acc * 60 + Number(p), 0)
  return secs < 0 ? NaN : secs
}

/** 75.3 -> '1:15.3' ; 3725 -> '1:02:05' */
export function formatTime(sec: number, decimals = 1): string {
  if (!isFinite(sec)) return '--:--'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  let ss = decimals ? s.toFixed(decimals) : String(Math.floor(s))
  if (s < 10) ss = '0' + ss
  ss = ss.replace(/\.0+$/, '')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 75 -> '1m15s' (para nomes de arquivo) */
export function fileTime(sec: number): string {
  const total = Math.round(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s` : `${m}m${String(s).padStart(2, '0')}s`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}
