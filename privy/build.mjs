import { build } from 'esbuild';
await build({
  entryPoints: ['entry.jsx'], bundle: true, minify: true, format: 'iife', target: 'es2020', outfile: '../site/js/privy.js',
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' }, legalComments: 'none', logLevel: 'warning',
});
