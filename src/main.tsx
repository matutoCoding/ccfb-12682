import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { TransportProvider } from './core/TransportContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TransportProvider>
      <App />
    </TransportProvider>
  </React.StrictMode>,
);
