import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const host = document.getElementById('root');
if (!host) throw new Error('#root 挂载点缺失');

createRoot(host).render(
  <App />
);
