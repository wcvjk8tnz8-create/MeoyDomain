import { useEffect, useLayoutEffect, useState, type JSX } from 'react';
import { navigate, bumpPageGeneration } from './lib/runtime';
import { startI18n } from './lib/i18n';
import { beginTransition } from './lib/pageTransition';
import { prefetchRoute } from './lib/prefetch';
import LoginPage from './pages/Login';
import HomePage from './pages/Home';
import DashboardPage from './pages/Dashboard';
import DomainPage from './pages/Domain';
import RegisterPage from './pages/Register';
import WhoisPage from './pages/Whois';
import AdminPage from './pages/Admin';
import CheckinPage from './pages/Checkin';
import RewardsPage from './pages/Rewards';
import ChatPage from './pages/Chat';
import TicketsPage from './pages/Tickets';
import TransferPage from './pages/Transfer';
import ProfilePage from './pages/Profile';
import TermsPage from './pages/Terms';
import ReportPage from './pages/Report';

/* 保留旧 URL，书签 / 站内链接 / Worker 重定向全部继续可用 */
const ROUTES: Record<string, () => JSX.Element> = {
  /* 官网根路径 = 主页（Zerexa 落地页）；登录独立成 /login，
     未登录跳登录、退出登录都走它，不会再让访问域名时撞见登录表单。 */
  '/': HomePage,
  '/index.html': HomePage,
  '/login': LoginPage,
  '/login.html': LoginPage,
  '/home': HomePage,
  '/home.html': HomePage,
  '/dashboard': DashboardPage,
  '/dashboard.html': DashboardPage,
  '/domain': DomainPage,
  '/domain.html': DomainPage,
  '/register': RegisterPage,
  '/register.html': RegisterPage,
  '/whois': WhoisPage,
  '/whois.html': WhoisPage,
  '/admin': AdminPage,
  '/admin.html': AdminPage,
  '/checkin': CheckinPage,
  '/checkin.html': CheckinPage,
  '/rewards': RewardsPage,
  '/rewards.html': RewardsPage,
  '/chat': ChatPage,
  '/chat.html': ChatPage,
  '/tickets': TicketsPage,
  '/tickets.html': TicketsPage,
  '/transfer': TransferPage,
  '/transfer.html': TransferPage,
  '/profile': ProfilePage,
  '/profile.html': ProfilePage,
  '/terms': TermsPage,
  '/terms.html': TermsPage,
  '/report': ReportPage,
  '/report.html': ReportPage,
  '/abuse': ReportPage,
  '/abuse.html': ReportPage,
};

function keyOf(pathname: string): string {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (ROUTES[p]) return p;
  // Cloudflare Assets 会把 /xxx.html 规范化成 /xxx，两种都认
  if (ROUTES[p + '.html']) return p + '.html';
  return '/';
}

/** 站内链接走 SPA，不刷新整页（外链 / 新窗口 / 锚点保持原行为） */
function isInternal(href: string): boolean {
  if (!href) return false;
  if (/^(https?:|mailto:|tel:|#|javascript:|data:)/i.test(href)) return false;
  if (/\.(css|js|png|jpe?g|ico|svg|webp|json|txt|woff2?|zip|pdf)(\?|$)/i.test(href)) return false;
  const path = href.split(/[?#]/)[0];
  return !!ROUTES[path] || !!ROUTES[path + '.html'];
}

/** 页面级的独立视觉脚本（已 TypeScript 化，切页时按需挂载） */
let cloudMounted = false;
async function mountPageVisuals(key: string) {
  // 官网根路径现在就是主页，/home 保留为旧书签别名，两者用同一套视觉
  if (!['/', '/index.html', '/home', '/home.html'].includes(key)) return;
  if (cloudMounted) return;
  cloudMounted = true;
  try {
    const m = await import('./lib/cloudShader');
    m.mountCloudShader();
  } catch (e) {
    console.warn('[cloud-shader] 未启用，回退 CSS 天空背景', e);
  }
}

export default function App() {
  const [key, setKey] = useState(() => keyOf(window.location.pathname));

  useEffect(() => {
    const onPop = () => setKey(keyOf(window.location.pathname));
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const a = t?.closest?.('a') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!isInternal(href) || a.target === '_blank' || a.hasAttribute('download')) return;
      // 只允许左键、无修饰键；hash 变化仍交给浏览器
      // 点击这一瞬间就并行拉目标页首屏数据；Miku 冒出 + 数据到手才换页，
      // 换过去直接渲染完整内容，不再「切过去 → 空壳 → 串行等接口」。
      e.preventDefault();
      beginTransition(() => navigate(href), prefetchRoute(href));
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick);
    };
  }, []);

  useLayoutEffect(() => {
    // 每次路由挂载递增世代：上一页还没结算完的就绪回调随即作废，
    // 不会把这一页的骨架提前放出来
    bumpPageGeneration();
    // 首屏数据没到齐前整页先藏着：否则骨架里的占位「0 / 欢迎回来 /
    // 默认头像」会先露一帧，之后数据分几波补上，就是「一阶段二阶段三阶段」。
    // refreshRuntime() 在全部首屏 GET 结算后统一把 data-ready 置 1，整屏同帧出现。
    document.querySelectorAll('.page-root').forEach((el) => {
      (el as HTMLElement).dataset.ready = '0';
    });
    // 控制器异常时的兜底：3 秒后强制放出，绝不把页面永久藏住
    const failsafe = window.setTimeout(() => {
      document.querySelectorAll('.page-root[data-ready="0"]').forEach((el) => {
        (el as HTMLElement).dataset.ready = '1';
      });
    }, 3000);

    // 每个页面组件挂载都算一次切页：不依赖 popstate，避免某些路由路径漏掉动画
    beginTransition(undefined, prefetchRoute(location.href));
    mountPageVisuals(key);
    // 语言切换器与翻译在每次切页后补挂（内部幂等）。
    // 用 layout effect 而非 effect：绘制前就完成首次翻译，英文模式不会先闪一帧中文。
    try { startI18n(); } catch { /* 不影响页面功能 */ }
    return () => window.clearTimeout(failsafe);
  }, [key]);

  const Page = ROUTES[key] || HomePage;
  // key 变化会卸载旧页面：cleanupPage() 清掉旧控制器注册的事件与定时器
  return <Page key={key} />;
}
