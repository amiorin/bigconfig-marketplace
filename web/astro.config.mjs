import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  outDir: '../pocketbase/pb_public',
  vite: {
    plugins: [tailwindcss()],
  },
});
