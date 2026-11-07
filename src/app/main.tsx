import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/components.css';
import './styles/index.css';
/* 收口 17 组历史断点冲突，统一手机端与 21:9 等比例（管布局定位） */
import './styles/responsive.css';
/* 视觉重构层：Zerexa 高雅公共页 + PowerDNS/HL6 密度控制台。
   只覆盖颜色/字体/圆角/密度，不写 left/top/width/margin，
   因此放在 responsive.css 之后也不会破坏多比例布局。 */
import './styles/theme-terra.css';
/* 统一动效层必须最后加载：压过 theme-terra 里 6 处 transform:none!important，
   并把四层各写各的时长/缓动收口到同一组令牌。 */
import './styles/motion.css';
/* 布局重构层必须最后加载：浮起的玻璃侧栏 / 顶栏 + 全站液态玻璃材质 +
   墨绿主题。以同等 specificity 收口前五层的 !important，不再叠加第 7 层。 */
import './styles/liquid-glass.css';
/* 切页过渡：Miku 冒出来 + 跳转中气泡。挂在 body 上，不随 SPA 页面卸载。 */
import { mountTransition } from './lib/pageTransition';

const host = document.getElementById('root');
if (!host) throw new Error('#root 挂载点缺失');

mountTransition();
createRoot(host).render(
  <App />
);
