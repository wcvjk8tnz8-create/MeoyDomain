import { useEffect, useState, type JSX } from 'react';
import { navigate } from './lib/runtime';
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

/* 保留旧 URL，书签 / 站内链接 / Worker 重定向全部继续可用 */
const ROUTES: Record<string, () => JSX.Element> = {
  '/': LoginPage,
  '/index.html': LoginPage,
  '/login': LoginPage,
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
  if (key !== '/home' && key !== '/home.html') return;
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
      e.preventDefault();
      navigate(href);
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('click', onClick);
    };
  }, []);

  useEffect(() => {
    mountPageVisuals(key);
  }, [key]);

  const Page = ROUTES[key] || LoginPage;
  // key 变化会卸载旧页面：cleanupPage() 清掉旧控制器注册的事件与定时器
  return <Page key={key} />;
}
