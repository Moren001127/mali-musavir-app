'use client';

import { useEffect } from 'react';

export function PwaRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });

      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.filter((key) => key.startsWith('moren-pwa-')).forEach((key) => caches.delete(key));
        });
      }

      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });

        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;

          if (!worker) {
            return;
          }

          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('PWA service worker registration failed', error);
        }
      }
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });

    return () => {
      window.removeEventListener('load', register);
    };
  }, []);

  return null;
}
