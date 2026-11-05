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

const host = document.getElementById('root');
if (!host) throw new Error('#root 挂载点缺失');

createRoot(host).render(
  <App />
);
