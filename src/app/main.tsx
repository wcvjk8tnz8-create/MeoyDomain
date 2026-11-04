import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/components.css';
import './styles/index.css';

const host = document.getElementById('root');
if (!host) throw new Error('#root 挂载点缺失');

createRoot(host).render(
  <App />
);
