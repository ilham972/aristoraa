'use client';

import Link from 'next/link';
import { Bell, BellDot, Check, CheckCheck } from 'lucide-react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/lib/convex';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
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

export function NotificationBell() {
  const unseen = useQuery(api.notifications.unseenCount);
  const items = useQuery(api.notifications.listForCurrentUser, { limit: 12 });
  const markSeen = useMutation(api.notifications.markSeen);
  const markAllSeen = useMutation(api.notifications.markAllSeen);

  const count = typeof unseen === 'number' ? unseen : 0;
  const hasUnseen = count > 0;
  const list = items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex items-center justify-center h-10 w-10 rounded-full bg-card/80 backdrop-blur-md border border-border/60 hover:bg-card transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${count} unseen notification${count === 1 ? '' : 's'}`}
      >
        {hasUnseen ? (
          <BellDot className="h-[18px] w-[18px] text-foreground" />
        ) : (
          <Bell className="h-[18px] w-[18px] text-muted-foreground" />
        )}
        {hasUnseen && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-semibold text-white flex items-center justify-center leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[340px] sm:w-[400px] p-0 overflow-hidden border-border/60"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
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
        <ScrollArea className="max-h-[440px]">
          {list.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              {items === undefined ? 'Loading…' : 'No notifications yet.'}
            </div>
          ) : (
            <ul>
              {list.map((n) => {
                const dot = PRIORITY_DOT[n.priority] ?? PRIORITY_DOT.normal;
                const unseen = !n.seenAt;
                const node = (
                  <div
                    className={cn(
                      'flex gap-3 px-3 py-2.5 border-b border-border/40 last:border-b-0 transition-colors',
                      unseen ? 'bg-card/60' : 'bg-transparent',
                      n.actionUrl && 'cursor-pointer hover:bg-card',
                    )}
                    onClick={() => {
                      if (unseen) void markSeen({ id: n._id });
                    }}
                  >
                    <div className="pt-1.5">
                      <span className={cn('inline-block h-2 w-2 rounded-full', dot)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={cn(
                            'text-sm leading-tight truncate',
                            unseen ? 'font-semibold' : 'font-medium text-muted-foreground',
                          )}
                        >
                          {n.title}
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      {n.body && (
                        <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {n.body}
                        </div>
                      )}
                    </div>
                    {!unseen && (
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
        </ScrollArea>
        <div className="px-3 py-2 border-t border-border/60 text-center">
          <Link
            href="/messaging"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Open messaging hub →
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
