import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import { LanguageProvider } from './lib/i18n.tsx';

const App = lazy(() => import('./App.tsx'));
const MarketingSite = lazy(() => import('./marketing/MarketingSite.tsx'));

const params = new URLSearchParams(window.location.search);
const menuId = params.get('restaurantId');
const staffId = params.get('loginRestaurantId');
const destination = menuId ? 'https://menu.ordova.cc/' : staffId ? 'https://rest.ordova.cc/' : null;
const showProductApp = window.location.pathname.startsWith('/app');

if (destination) {
  const target = new URL(destination);
  target.search = window.location.search;
  target.searchParams.delete(menuId ? 'loginRestaurantId' : 'restaurantId');
  window.location.replace(target.toString());
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LanguageProvider>
        <Suspense fallback={<div style={{ minHeight: '100vh', background: '#F8F8F6' }} />}>
          {showProductApp ? <App /> : <MarketingSite />}
        </Suspense>
      </LanguageProvider>
    </StrictMode>,
  );
}
