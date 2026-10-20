import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/app/App';
import { AntdProvider } from '@/app/AntdProvider';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import '@/styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SettingsProvider>
        <AntdProvider>
          <App />
        </AntdProvider>
      </SettingsProvider>
    </ErrorBoundary>
  </StrictMode>,
);
