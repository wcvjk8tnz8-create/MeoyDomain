import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/components.css';
import './styles/index.css';
/* 必须最后加载：收口 17 组历史断点冲突，统一手机端与 21:9 等比例 */
import './styles/responsive.css';

const host = document.getElementById('root');
if (!host) throw new Error('#root 挂载点缺失');

createRoot(host).render(
  <App />
);
