import { useSyncExternalStore } from 'react';

export interface Route {
  page: string;
  params: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { page: parts[0] || 'dashboard', params: parts.slice(1), query: new URLSearchParams(qs ?? '') };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function go(path: string) {
  location.hash = '#/' + path.replace(/^\/+/, '');
}

export const href = (path: string) => '#/' + path.replace(/^\/+/, '');
