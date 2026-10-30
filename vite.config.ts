import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo se usa un proxy para evitar problemas de CORS con el backend real.
// El frontend llama a "/api/..." (mismo origen) y Vite reenvía la petición a la URL base.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target =
    env.VITE_API_PROXY_TARGET ||
    'https://finesa-front-demo-1063009710641.us-east4.run.app';

  return {
    plugins: [react()],
    build: { target: 'es2022' },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
