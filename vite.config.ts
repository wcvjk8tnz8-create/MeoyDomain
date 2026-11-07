import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

/**
 * 前端产物输出到 dist/client，由 Cloudflare Workers [assets] 托管。
 * public/ 里的 css / img / favicon 会原样复制过去；
 * 旧的 14 个手写 .html 页面已全部迁移为 src/app/pages/*.tsx，
 * 最后一份 index.html 也改由 src/html/spa.ts 在构建前生成（见 package.json）。
 *
 * PostCSS / Tailwind 配置直接内联在这里，仓库不再有 .js 配置文件。
 */
const tailwindConfig = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  corePlugins: {
    // 组件层自带 reset（*{box-sizing} 等），关闭 preflight 避免二次覆盖
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: 'hsl(var(--card))',
        'surface-2': 'hsl(var(--popover))',
        line: 'hsl(var(--border))',
        ink: 'hsl(var(--foreground))',
        subtle: 'hsl(var(--muted-foreground))',
        primary: 'hsl(var(--primary))',
        'primary-ink': 'hsl(var(--primary-foreground))',
        secondary: 'hsl(var(--secondary))',
        accent: 'hsl(var(--accent))',
        danger: 'hsl(var(--destructive))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        td: 'var(--radius)',
        'td-sm': 'calc(var(--radius) - 6px)',
        'td-lg': 'calc(var(--radius) + 8px)',
      },
      boxShadow: { td: 'var(--shadow)' },
      fontFamily: {
        sans: ['var(--sans)', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['var(--mono)', 'ui-monospace', 'monospace'],
        display: ['var(--display)', 'var(--sans)', 'sans-serif'],
      },
      spacing: { sb: 'var(--sb-w)', top: 'var(--top-h)' },
    },
  },
  plugins: [],
};

export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  css: {
    postcss: {
      plugins: [tailwindcss(tailwindConfig as any), autoprefixer()],
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: { port: 5173, strictPort: false },
});
