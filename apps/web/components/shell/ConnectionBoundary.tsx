'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type ConnectionState = 'online' | 'offline' | 'reconnecting';

const ConnectionContext = createContext<ConnectionState>('online');

export function useConnection(): ConnectionState {
  return useContext(ConnectionContext);
}

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/**
 * S35 connection boundary: a persistent, text-labelled banner (never a toast
 * storm or a full-screen spinner hiding the last confirmed state). Realtime
 * socket status feeds in from phase 05; browser connectivity is tracked now.
 */
export function ConnectionBoundary({ children }: { children: ReactNode }) {
  const browserOnline = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  const [recovered, setRecovered] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!browserOnline) {
      const timer = setTimeout(() => setWasOffline(true), 0);
      return () => clearTimeout(timer);
    }
    if (!wasOffline) return;
    const show = setTimeout(() => setRecovered(true), 0);
    const hide = setTimeout(() => {
      setRecovered(false);
      setWasOffline(false);
    }, 4000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [browserOnline, wasOffline]);

  const state: ConnectionState = browserOnline ? 'online' : 'offline';
  return (
    <ConnectionContext.Provider value={state}>
      {!browserOnline ? (
        <div
          role="alert"
          className="border-b border-warn/60 bg-[#2d2412] px-[var(--gutter)] py-2 text-sm"
        >
          <strong className="font-semibold">Offline.</strong> Actions are paused until your
          connection returns. Nothing you confirmed is lost.
        </div>
      ) : recovered ? (
        <div
          role="status"
          className="border-b border-ok/50 bg-[#0f2a22] px-[var(--gutter)] py-2 text-sm"
        >
          <strong className="font-semibold">Back online.</strong> Latest state restored.
        </div>
      ) : null}
      {children}
    </ConnectionContext.Provider>
  );
}
