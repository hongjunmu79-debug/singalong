import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: '跟唱',
        short_name: '跟唱',
        description: '演唱会实时歌词提词器',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // index.html 不进预缓存，否则新版本永远拿不到（导航走下面的网络优先）
        globIgnores: ['**/index.html'],
        runtimeCaching: [
          {
            // 页面导航：先问网络，3 秒拿不到再用缓存。断网时仍然可用，
            // 但重新构建后刷新就能立刻拿到新版本，不会卡在旧代码上。
            urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
            handler: 'NetworkFirst' as const,
            options: { cacheName: 'pages', networkTimeoutSeconds: 3 },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    // 通过 Tailscale 的 ts.net 域名访问时，Host 头不是 localhost，需要放行
    allowedHosts: ['.ts.net'],
  },
  preview: {
    host: true,
    allowedHosts: ['.ts.net'],
  },
})
