import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { ICON_NAMES } from './src/ui/icon-names'

// index.html loads only the Material Symbols glyphs the console uses. The list lives in
// src/ui/icon-names.ts and is injected here, so the subset and the Icon type cannot drift.
function materialSymbolsSubset(): Plugin {
  return {
    name: 'verdictchain-material-symbols-subset',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%MATERIAL_ICON_NAMES%', [...ICON_NAMES].sort().join(',')),
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), materialSymbolsSubset()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
})
