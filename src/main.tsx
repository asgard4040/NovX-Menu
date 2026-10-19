import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LanguageProvider } from './lib/i18n.tsx';
import { canonicalPortalRedirect } from './lib/public-urls.ts';

const redirect = canonicalPortalRedirect(window.location.href);
if (redirect) {
  window.location.replace(redirect);
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </StrictMode>,
  );
}
