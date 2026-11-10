import { useState } from 'react'
import { DEFAULT_SERVER, getServerUrl, setServerUrl } from '../lib/server'

const zipUrl = import.meta.env.BASE_URL + 'video-tools-servidor.zip'

export function ServerHelp() {
  const [custom, setCustom] = useState(getServerUrl())
  return (
    <div className="help">
      <p>
        Para baixar por link, o site usa o <b>yt-dlp</b> do seu computador por meio de um pequeno servidor local. Os
        sites de vídeo bloqueiam downloads feitos direto pelo navegador, por isso ele é necessário. Faça isto uma vez:
      </p>
      <ol>
        <li>
          No Terminal/PowerShell, instale as ferramentas:
          <pre>
            winget install OpenJS.NodeJS.LTS{'\n'}winget install yt-dlp.yt-dlp{'\n'}winget install Gyan.FFmpeg
          </pre>
        </li>
        <li>
          <a href={zipUrl} download>
            Baixe o servidor (.zip)
          </a>
          , extraia e dê dois cliques em <code>iniciar-servidor.bat</code>.
        </li>
        <li>
          Deixe a janela aberta. Esta página detecta o servidor sozinha. Se o Chrome perguntar se o site pode acessar
          a rede local, clique em <b>Permitir</b>.
        </li>
      </ol>
      <details>
        <summary>Usar outra porta</summary>
        <div className="row">
          <input value={custom} onChange={(e) => setCustom(e.target.value)} className="grow" />
          <button
            type="button"
            onClick={() => {
              setServerUrl(custom.trim())
              location.reload()
            }}
          >
            Salvar
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setServerUrl(DEFAULT_SERVER)
              location.reload()
            }}
          >
            Padrão
          </button>
        </div>
      </details>
    </div>
  )
}
