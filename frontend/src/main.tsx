import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/app/App';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import '@/styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </ErrorBoundary>
  </StrictMode>,
);
