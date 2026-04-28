import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  outDir: '../pocketbase/pb_public',
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
