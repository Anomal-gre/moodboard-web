import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { initPwaInstallListener } from './features/landing/usePwaInstall';

initPwaInstallListener();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
