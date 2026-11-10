import { useEffect, useState } from 'react'
import { folderPickerSupported, loadFolder, pickFolder } from '../lib/fs'

/** Pasta de destino lembrada entre visitas (por chave). */
export function useFolder(key: string) {
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null)
  useEffect(() => {
    loadFolder(key).then((h) => h && setFolder(h))
  }, [key])
  const choose = async () => {
    const h = await pickFolder(key)
    if (h) setFolder(h)
  }
  return { folder, choose, clear: () => setFolder(null) }
}

type Props = {
  label: string
  folder: FileSystemDirectoryHandle | null
  onChoose: () => void
  onClear: () => void
  fallback: string
  disabled?: boolean
}

export function FolderField({ label, folder, onChoose, onClear, fallback, disabled }: Props) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {folderPickerSupported ? (
        <div className="row">
          <div className={'folder' + (folder ? '' : ' muted')} title={folder?.name}>
            <FolderIcon />
            <span>{folder ? folder.name : fallback}</span>
          </div>
          <button type="button" onClick={onChoose} disabled={disabled}>
            Escolher pasta…
          </button>
          {folder && (
            <button type="button" className="ghost" onClick={onClear} disabled={disabled} title="Usar o padrão do navegador">
              Limpar
            </button>
          )}
        </div>
      ) : (
        <p className="hint">
          Seu navegador não permite escolher a pasta. Os arquivos vão para a pasta de downloads. Para escolher a pasta, use
          o Chrome ou o Edge no computador.
        </p>
      )}
    </div>
  )
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}
