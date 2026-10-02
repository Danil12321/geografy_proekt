import { defineConfig } from 'vite';

export default defineConfig({
  // './' делает пути относительными: сайт работает на GitHub Pages
  // при любом названии репозитория и при открытии из папки dist
  base: './',
});
