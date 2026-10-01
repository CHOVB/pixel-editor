/**
 * 프로그램 시작점 (Entry Point)
 * ------------------------------------------------------------
 * index.html 의 <div id="root"> 안에 React 앱(App)을 그립니다.
 *  - ErrorBoundary: 화면 오류가 나도 작업을 지키고 복구 화면을 보여줍니다.
 *  - 서비스 워커: 배포된 웹 버전에서 오프라인 실행/설치(PWA)를 가능하게 합니다.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 요소를 찾을 수 없습니다.');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// 배포 버전(웹)에서만 서비스 워커 등록 – 개발 중이거나 데스크톱 앱(Tauri)에서는 사용하지 않습니다.
const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
if (import.meta.env.PROD && !isDesktop && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`./sw.js?v=${__APP_VERSION__}`).catch((err) => console.warn('서비스 워커 등록 실패', err));
  });
}
