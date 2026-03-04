import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [
        tailwindcss(),
    ],
    server: {
        proxy: {
            '/api': {
                target: 'https://api.muapi.ai',
                changeOrigin: true,
                secure: false
            },
            '/fal': {
                target: 'https://queue.fal.run',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/fal/, ''),
                secure: false
            }
        }
    }
});
