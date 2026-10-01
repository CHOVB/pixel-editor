/**
 * 프로그램 시작점 (Entry Point)
 * ------------------------------------------------------------
 * index.html 의 <div id="root"> 안에 React 앱(App)을 그립니다.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소를 찾을 수 없습니다.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
