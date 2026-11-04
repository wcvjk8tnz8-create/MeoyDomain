/** TerraDomain · Tailwind 主题
 *  颜色令牌映射到站点 CSS 变量，深色主题由 [data-theme="dark"] 自动切换，
 *  无需为每个组件写 dark: 变体。 */
export default {
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
