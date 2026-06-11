'use client';

// useCachedQuery — drop-in replacement for Convex's useQuery that gives the
// app a native feel (perf phase 3, 2026-06-12): the last result of every
// query is persisted to localStorage, and on the next visit it is returned
// INSTANTLY while the live subscription catches up in the background
// (stale-while-revalidate, the same pattern native apps use).
//
// Safety properties:
//   - Read-path only. Never writes to Convex; mutations are untouched.
//   - The live value always wins the moment it arrives — stale data is
//     visible for roughly one round trip, then replaced reactively.
//   - Cache writes are best-effort (quota/serialization failures are
//     swallowed); a cache miss simply behaves exactly like plain useQuery.
//   - Device-local only, and the app sits behind Clerk auth. This is the
//     founder's own device; do NOT use this hook for anything that must
//     never be rendered a-second-stale (there is nothing like that today).
//
// Use for HOT read queries on daily surfaces (home, session tabs). Not
// needed on admin pages where a loading state is acceptable.

import { useQuery } from 'convex/react';
import { getFunctionName } from 'convex/server';
import type { FunctionReference, FunctionArgs, FunctionReturnType } from 'convex/server';
import { useEffect, useMemo, useState } from 'react';

const PREFIX = 'cq1:'; // bump to invalidate every cached entry at once

function cacheKey(query: FunctionReference<'query'>, args: unknown): string {
  return PREFIX + getFunctionName(query) + ':' + JSON.stringify(args ?? {});
}

function readCache<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function useCachedQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args?: FunctionArgs<Query> | 'skip',
): FunctionReturnType<Query> | undefined {
  const live = useQuery(query, args as never);
  const skipped = args === 'skip';

  const key = useMemo(
    () => (skipped ? null : cacheKey(query, args)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skipped, skipped ? '' : cacheKey(query, args)],
  );

  // Hydration-safe: first render (incl. SSR/prerender) returns undefined like
  // plain useQuery; the cached value appears in a client-only effect pass.
  const [cached, setCached] = useState<FunctionReturnType<Query> | undefined>(undefined);

  useEffect(() => {
    if (!key) return;
    setCached(readCache<FunctionReturnType<Query>>(key));
  }, [key]);

  useEffect(() => {
    if (!key || live === undefined) return;
    try {
      localStorage.setItem(key, JSON.stringify(live));
    } catch {
      // quota full or unserializable — cache is best-effort by design
    }
  }, [key, live]);

  if (skipped) return undefined;
  return live !== undefined ? live : cached;
}
