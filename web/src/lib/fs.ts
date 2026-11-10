// Salvar arquivos numa pasta escolhida pelo usuário (File System Access API — Chrome/Edge).
// Em navegadores sem suporte, cai para o download normal do navegador.

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string
      mode?: 'read' | 'readwrite'
      startIn?: string
    }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemHandle {
    queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
    requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
}

export const folderPickerSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ------------------------------------------------ IndexedDB (lembrar a pasta)
const DB = 'video-tools'
const STORE = 'handles'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

export async function loadFolder(key: string): Promise<FileSystemDirectoryHandle | null> {
  if (!folderPickerSupported) return null
  try {
    return (await idb<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(key))) ?? null
  } catch {
    return null
  }
}

export async function pickFolder(key: string): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null
  try {
    const handle = await window.showDirectoryPicker({ id: key, mode: 'readwrite', startIn: 'downloads' })
    await idb('readwrite', (s) => s.put(handle, key)).catch(() => {})
    return handle
  } catch (err) {
    if ((err as DOMException).name === 'AbortError') return null
    throw err
  }
}

/** Garante permissão de escrita. Precisa ser chamado a partir de um clique. */
export async function ensureWritable(dir: FileSystemDirectoryHandle): Promise<boolean> {
  if (!dir.queryPermission || !dir.requestPermission) return true
  if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true
  return (await dir.requestPermission({ mode: 'readwrite' })) === 'granted'
}

// ------------------------------------------------ nomes
export function safeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f%]/g, '_').replace(/[. ]+$/, '').trim()
  return cleaned || 'arquivo'
}

export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf('.')
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, '']
}

async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

export async function uniqueName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  if (!(await exists(dir, name))) return name
  const [stem, ext] = splitExt(name)
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!(await exists(dir, candidate))) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

// ------------------------------------------------ gravação
export async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | Uint8Array | ReadableStream<Uint8Array>,
): Promise<FileSystemFileHandle> {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  if (data instanceof ReadableStream) {
    await data.pipeTo(writable) // fecha o arquivo sozinho
  } else {
    await writable.write(data instanceof Uint8Array ? new Blob([data as BlobPart]) : data)
    await writable.close()
  }
  return handle
}

/** Download comum do navegador (vai para a pasta Downloads). */
export function browserDownload(data: Blob | string, name: string) {
  const url = typeof data === 'string' ? data : URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (typeof data !== 'string') setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
