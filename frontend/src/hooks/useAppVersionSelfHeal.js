import { useEffect } from 'react';

const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const RELOAD_MARKER_KEY = '__aa_forced_reload_version__';
const CURRENT_APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

const buildReloadUrl = (targetVersion) => {
  const url = new URL(window.location.href);
  url.searchParams.set('appv', targetVersion);
  return url.toString();
};

const fetchLatestVersion = async () => {
  const response = await fetch(`/version.json?ts=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });

  if (!response.ok) return null;
  const payload = await response.json();
  const version = String(payload?.version || '').trim();
  return version || null;
};

export default function useAppVersionSelfHeal() {
  useEffect(() => {
    let intervalId = null;
    let isChecking = false;

    const maybeRefreshForNewVersion = async () => {
      if (isChecking || document.visibilityState === 'hidden' || !navigator.onLine) {
        return;
      }

      isChecking = true;
      try {
        const latestVersion = await fetchLatestVersion();
        if (!latestVersion || latestVersion === CURRENT_APP_VERSION) {
          return;
        }

        const alreadyReloadedFor = sessionStorage.getItem(RELOAD_MARKER_KEY);
        if (alreadyReloadedFor === latestVersion) {
          return;
        }

        sessionStorage.setItem(RELOAD_MARKER_KEY, latestVersion);
        window.location.replace(buildReloadUrl(latestVersion));
      } catch {
        // Silent fail: version checks should never disrupt active sessions.
      } finally {
        isChecking = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void maybeRefreshForNewVersion();
      }
    };

    void maybeRefreshForNewVersion();
    intervalId = window.setInterval(() => {
      void maybeRefreshForNewVersion();
    }, DEFAULT_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);
}
