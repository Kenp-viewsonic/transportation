import { defineConfig } from 'vite';

/**
 * Vite 配置。
 *
 * 局域网访问（手机 / 同事电脑打开）：
 *   - 运行 `npm run dev:lan`（等价于 `vite --host 0.0.0.0`）
 *   - 启动后终端会打印 Network 地址，形如 http://192.168.x.x:5173
 *
 * 这里同时把 host 设为 true、allowedHosts 放开，
 * 避免 Vite 5 对非 localhost Host 头的拦截（提示 "Blocked request"）。
 */
export default defineConfig({
  // GitHub Pages 部署在子路径（/<仓库名>/）下，用相对路径保证资源加载
  base: './',
  server: {
    host: true, // 监听 0.0.0.0，局域网可访问
    port: 5173,
    strictPort: false,
    allowedHosts: true, // 允许任意 Host 头（内网使用足够）
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
});
