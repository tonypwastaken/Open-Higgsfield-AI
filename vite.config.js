import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    // Load ALL env vars (no prefix filter) so FAL_AI_API_KEY and MUAPI_KEY
    // can be used without the VITE_ prefix requirement.
    const env = loadEnv(mode, process.cwd(), '');

    return {
        plugins: [
            tailwindcss(),
        ],
        define: {
            'import.meta.env.FAL_AI_API_KEY': JSON.stringify(env.FAL_AI_API_KEY || ''),
            'import.meta.env.MUAPI_KEY': JSON.stringify(env.MUAPI_KEY || ''),
        },
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
    };
});
