import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyTheme, getThemePref } from './lib/theme';

// Paint before first render so the window never flashes the wrong theme.
applyTheme(getThemePref());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
