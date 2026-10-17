import { useEffect, useState } from 'react';
import { DEFAULT_SYSTEM_LOGO } from './brand';

export function usePublicSystemLogo() {
  const [logo, setLogo] = useState(() => localStorage.getItem('novix_system_logo') || DEFAULT_SYSTEM_LOGO);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/public/system-brand', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('branding_unavailable')))
      .then((data) => setLogo(typeof data.logoUrl === 'string' && data.logoUrl ? data.logoUrl : DEFAULT_SYSTEM_LOGO))
      .catch((error) => { if (error.name !== 'AbortError') console.warn('Using default system branding', error); });
    return () => controller.abort();
  }, []);

  return logo;
}
