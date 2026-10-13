import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme.css';
import { readLocaleSettingSync, resolveLocale } from './lib/i18n';

// First paint already carries the right lang (store boots from the same read).
document.documentElement.lang = resolveLocale(readLocaleSettingSync());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
