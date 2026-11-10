# Video Tools

Site para **baixar vídeos por link** e **transformar vídeos em GIFs** (ou extrair os quadros como PNG).

**Acesse:** https://valcanaia282.github.io/video-tools/

| Aba | Como funciona |
| --- | --- |
| **Baixar vídeo** | Cole o link (YouTube, Instagram, TikTok, X e [muitos outros](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)), escolha o formato (MP4, melhor qualidade ou MP3), opcionalmente um trecho, e a pasta onde salvar. Usa o **yt-dlp** do seu computador por meio do servidor local. |
| **Vídeo → GIFs** | Divide o vídeo em vários GIFs de N segundos, gera um GIF de um trecho ou extrai os quadros em PNG. Roda **100% no navegador** com FFmpeg em WebAssembly — o vídeo não sai do seu computador. |

Escolher a pasta de destino funciona no **Chrome** e no **Edge** (desktop). Em outros navegadores os arquivos vão para a pasta de downloads (vários GIFs viram um `.zip`).

## Servidor local (só para a aba "Baixar vídeo")

Os sites de vídeo não deixam o navegador baixar direto, e o GitHub Pages não roda programas. Por isso, um pequeno servidor em Node.js roda no seu PC e faz a ponte com o yt-dlp.

1. Instale as ferramentas (uma vez só):
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install yt-dlp.yt-dlp
   winget install Gyan.FFmpeg
   ```
2. Baixe o servidor pelo próprio site (link "Baixe o servidor (.zip)") ou use a pasta [`server/`](server/) deste repositório.
3. Dê dois cliques em `iniciar-servidor.bat` (ou rode `node server.mjs`) e deixe a janela aberta.
4. Abra o site. Se o Chrome perguntar se o site pode acessar a rede local, clique em **Permitir**.

O servidor escuta só em `127.0.0.1:5123` (não fica exposto na rede) e só aceita pedidos do site oficial e do ambiente de desenvolvimento. Para usar outra porta: `PORT=6000 node server.mjs` e ajuste em "Usar outra porta" no site.

Se um site parar de funcionar, atualize o yt-dlp: `winget upgrade yt-dlp.yt-dlp`.

## Tecnologias

- **Site:** React 19 + TypeScript + Vite, [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), File System Access API, fflate (zip)
- **Servidor local:** Node.js puro (sem dependências) + yt-dlp + ffmpeg
- **Hospedagem:** GitHub Pages, publicado por GitHub Actions a cada push na `main`

## Estrutura

```
web/      site (React + TS + Vite)
server/   servidor local (Node.js)
.github/  workflow de deploy no GitHub Pages
```

## Rodar localmente

```bash
cd server && node server.mjs        # terminal 1
cd web && npm install && npm run dev # terminal 2 → http://localhost:5173/video-tools/
```

## Aviso

Baixe apenas conteúdo que você tem direito de usar. Respeite os termos de uso das plataformas e os direitos autorais de quem criou o vídeo.
