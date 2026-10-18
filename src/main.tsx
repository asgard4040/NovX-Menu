import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import { LanguageProvider } from './lib/i18n.tsx';

const App = lazy(() => import('./App.tsx'));
const MarketingSite = lazy(() => import('./marketing/MarketingSite.tsx'));

const params = new URLSearchParams(window.location.search);
const showProductApp = window.location.pathname.startsWith('/app') || params.has('restaurantId') || params.has('loginRestaurantId') || params.has('portal');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#F8F8F6' }} />}>
        {showProductApp ? <App /> : <MarketingSite />}
      </Suspense>
    </LanguageProvider>
  </StrictMode>,
);
