import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * A callback whose identity never changes but which always runs the latest `fn`, so memoised
 * children (the chat, the board, the sidebar) are not re-rendered by a keystroke in the composer.
 * Call it from events and effects, not during render.
 */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useInsertionEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
