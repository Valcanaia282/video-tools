import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// O site é publicado em https://valcanaia282.github.io/video-tools/
export default defineConfig({
  base: '/video-tools/',
  plugins: [react()],
  // O ffmpeg.wasm cria o próprio worker; o pré-bundle do Vite quebraria isso.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
})
