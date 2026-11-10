import { useState } from 'react'
import { DownloadTab } from './components/DownloadTab'
import { GifTab } from './components/GifTab'

type Tab = 'download' | 'gif'

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#gifs' ? 'gif' : 'download'))
  const [handoff, setHandoff] = useState<File | null>(null)

  const go = (t: Tab) => {
    setTab(t)
    history.replaceState(null, '', t === 'gif' ? '#gifs' : '#')
  }

  return (
    <div className="app">
      <header>
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path d="M12 9.5v13l11-6.5z" fill="#fff" />
          </svg>
          <h1>Video Tools</h1>
        </div>
        <p className="muted">Baixe vídeos por link e transforme vídeos em GIFs.</p>
      </header>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'download'} className={tab === 'download' ? 'active' : ''} onClick={() => go('download')}>
          Baixar vídeo
        </button>
        <button role="tab" aria-selected={tab === 'gif'} className={tab === 'gif' ? 'active' : ''} onClick={() => go('gif')}>
          Vídeo → GIFs
        </button>
      </nav>

      {/* As duas abas ficam montadas para não perder o que estava em andamento. */}
      <div hidden={tab !== 'download'}>
        <DownloadTab
          onSendToGif={(file) => {
            setHandoff(file)
            go('gif')
          }}
        />
      </div>
      <div hidden={tab !== 'gif'}>
        <GifTab active={tab === 'gif'} incoming={handoff} />
      </div>

      <footer className="muted">
        Os GIFs são gerados no seu navegador; o vídeo não é enviado para lugar nenhum. ·{' '}
        <a href="https://github.com/Valcanaia282/video-tools" target="_blank" rel="noreferrer">
          Código no GitHub
        </a>
      </footer>
    </div>
  )
}
