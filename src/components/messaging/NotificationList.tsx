'use client';

// Full notification list. Used by the /notifications page (reachable from the
// bottom-nav "Alerts" item). Replaces the old top-right bell dropdown.

import Link from 'next/link';
import { Check, CheckCheck } from 'lucide-react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/lib/convex';
import { cn } from '@/lib/utils';

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-amber-500',
  normal: 'bg-teal-400',
  low: 'bg-slate-400',
};

function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export function NotificationList() {
  const items = useQuery(api.notifications.listForCurrentUser, { limit: 50 });
  const unseen = useQuery(api.notifications.unseenCount);
  const markSeen = useMutation(api.notifications.markSeen);
  const markAllSeen = useMutation(api.notifications.markAllSeen);

  const hasUnseen = (typeof unseen === 'number' ? unseen : 0) > 0;
  const list = items ?? [];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="text-sm font-semibold">Notifications</div>
        {hasUnseen && (
          <button
            type="button"
            onClick={() => void markAllSeen({})}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all seen
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          {items === undefined ? 'Loading…' : 'No notifications yet.'}
        </div>
      ) : (
        <ul>
          {list.map((n) => {
            const dot = PRIORITY_DOT[n.priority] ?? PRIORITY_DOT.normal;
            const isUnseen = !n.seenAt;
            const node = (
              <div
                className={cn(
                  'flex gap-3 px-3 py-3 border-b border-border/40 last:border-b-0 transition-colors',
                  isUnseen ? 'bg-card/60' : 'bg-transparent',
                  n.actionUrl && 'cursor-pointer hover:bg-muted/40',
                )}
                onClick={() => {
                  if (isUnseen) void markSeen({ id: n._id });
                }}
              >
                <div className="pt-1.5">
                  <span className={cn('inline-block h-2 w-2 rounded-full', dot)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={cn(
                        'text-sm leading-tight',
                        isUnseen
                          ? 'font-semibold'
                          : 'font-medium text-muted-foreground',
                      )}
                    >
                      {n.title}
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  {n.body && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {n.body}
                    </div>
                  )}
                </div>
                {!isUnseen && (
                  <Check className="shrink-0 h-3.5 w-3.5 text-muted-foreground/60 mt-1" />
                )}
              </div>
            );
            return (
              <li key={n._id}>
                {n.actionUrl ? (
                  <Link href={n.actionUrl} className="block">
                    {node}
                  </Link>
                ) : (
                  node
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
