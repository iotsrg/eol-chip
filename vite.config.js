import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        cves: 'cves.html',
        exploits: 'exploits.html',
        fcc: 'fcc.html',
        eol: 'eol.html',
      },
    },
  },
})
