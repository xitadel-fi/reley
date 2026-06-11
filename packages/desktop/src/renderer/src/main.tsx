import React from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { App } from './App';
import { WelcomeScreen } from './features/WelcomeScreen';
import { DialogsProvider } from './components/Dialogs';
import { ToastProvider } from './components/Toast';
import { ThemeProvider, TooltipProvider } from './ui';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');

const params = new URLSearchParams(window.location.search);
const isWelcome = api.context.isWelcome || params.get('welcome') === '1';

createRoot(el).render(
  <React.StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <ToastProvider>
          <DialogsProvider>{isWelcome ? <WelcomeScreen /> : <App />}</DialogsProvider>
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
