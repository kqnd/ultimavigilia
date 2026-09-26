import { defineConfig, type Plugin } from 'vite';

/** Em desenvolvimento o HMR do Vite precisa de ws://localhost; no build a CSP é estrita. */
const devCsp = (): Plugin => ({
  name: 'dev-csp',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:* http://localhost:*");
  },
});

export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: false,
  plugins: [devCsp()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    sourcemap: false,
  },
});
