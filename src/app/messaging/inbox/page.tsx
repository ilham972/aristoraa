'use client';

// Phase W.5.A — /messaging/inbox.
//
// In-app parent conversations. Desktop: 2-column (list left, thread right).
// Mobile: list, tap into a full-screen thread, back returns. Replies enqueue a
// normal high-priority contact message through the existing sender (so pacing,
// quiet hours, per-number cooldown and the dev-mode redirect all still apply).

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Loader2,
  Send,
  Archive,
  ArchiveRestore,
  BellOff,
  Users,
  Inbox as InboxIcon,
  Clock,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtRelDay(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? fmtTime(ms) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function InboxPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <InboxInner />
    </Suspense>
  );
}

function InboxInner() {
  const params = useSearchParams();
  const initial = params.get('conversation');
  const [selected, setSelected] = useState<Id<'conversations'> | null>(
    initial ? (initial as Id<'conversations'>) : null,
  );
  const [showArchived, setShowArchived] = useState(false);

  const conversations = useQuery(api.messaging.inbox.listConversations, {
    archived: showArchived,
  });

  return (
    <div className="px-4 pt-6 pb-8 max-w-5xl mx-auto">
      <Link
        href="/messaging"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Messaging
      </Link>

      {/* On mobile, the thread takes over the screen when one is selected. */}
      <div className="flex gap-4">
        {/* List column */}
        <div className={cn('w-full sm:w-80 sm:shrink-0', selected && 'hidden sm:block')}>
          <header className="mb-3 flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Archive className="w-3.5 h-3.5" />
              {showArchived ? 'Active' : 'Archived'}
            </button>
          </header>

          {conversations === undefined && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {conversations && conversations.length === 0 && (
            <Card className="border-border/60">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {showArchived ? 'No archived conversations.' : 'No conversations yet.'}
              </CardContent>
            </Card>
          )}

          <div className="space-y-1.5">
            {(conversations ?? []).map((c) => (
              <button
                key={c.conversationId}
                type="button"
                onClick={() => setSelected(c.conversationId)}
                className={cn(
                  'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
                  selected === c.conversationId
                    ? 'border-teal-500/50 bg-teal-500/5'
                    : 'border-border/60 hover:bg-card/70',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold truncate text-foreground">
                    {c.displayName}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {fmtRelDay(c.lastAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-[11px] text-muted-foreground truncate">
                    {c.lastDirection === 'out' ? 'You: ' : ''}
                    {c.lastPreview || '—'}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-teal-500 text-white text-[10px] font-bold inline-flex items-center justify-center">
                      {c.unreadCount}
                    </span>
                  )}
                  {c.optedOut && <BellOff className="w-3 h-3 text-muted-foreground shrink-0" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Thread column */}
        <div className={cn('w-full min-w-0', !selected && 'hidden sm:block')}>
          {selected ? (
            <Thread
              conversationId={selected}
              onBack={() => setSelected(null)}
            />
          ) : (
            <div className="hidden sm:flex flex-col items-center justify-center h-full min-h-[300px] text-center text-sm text-muted-foreground">
              <InboxIcon className="w-8 h-8 mb-2 opacity-40" />
              Select a conversation to view the thread.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Thread({
  conversationId,
  onBack,
}: {
  conversationId: Id<'conversations'>;
  onBack: () => void;
}) {
  const thread = useQuery(api.messaging.inbox.getThread, { conversationId });
  const markRead = useMutation(api.messaging.inbox.markRead);
  const archive = useMutation(api.messaging.inbox.archive);
  const unarchive = useMutation(api.messaging.inbox.unarchive);
  const reply = useMutation(api.messaging.inbox.replyToConversation);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mark read when the thread opens / changes.
  useEffect(() => {
    void markRead({ conversationId });
  }, [conversationId, markRead]);

  // Keep the latest message in view as the thread grows.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread?.messages.length]);

  const recentlyMessaged = useMemo(() => {
    if (!thread?.lastOutboundAt) return false;
    return Date.now() - thread.lastOutboundAt < 5 * 60_000; // per-number cooldown window
  }, [thread?.lastOutboundAt]);

  const onSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await reply({ conversationId, body: text });
      setDraft('');
      if (res.deferred) toast.success('Reply queued — delivers tomorrow from 07:00');
      else toast.success('Reply queued — sending within 1–2 min');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send reply');
    } finally {
      setSending(false);
    }
  };

  if (thread === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (thread === null) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Conversation not found.</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-160px)] min-h-[400px] rounded-lg border border-border/60">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/60">
        <button
          type="button"
          onClick={onBack}
          className="sm:hidden text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">
            {thread.displayName}
            <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
              ···{thread.phoneE164.slice(-4)}
            </span>
          </p>
          {thread.siblings.length > 0 && (
            <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1 mt-0.5">
              <Users className="w-3 h-3" />
              {thread.siblings.map((s) => s.name).join(', ')}
            </p>
          )}
        </div>
        {thread.optedOut && (
          <span className="text-[10px] inline-flex items-center gap-1 text-muted-foreground">
            <BellOff className="w-3 h-3" /> Opted out
          </span>
        )}
        <button
          type="button"
          onClick={async () => {
            if (thread.archived) {
              await unarchive({ conversationId });
              toast.success('Unarchived');
            } else {
              await archive({ conversationId });
              toast.success('Archived');
              onBack();
            }
          }}
          className="text-muted-foreground hover:text-foreground"
          aria-label={thread.archived ? 'Unarchive' : 'Archive'}
        >
          {thread.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {thread.messages.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-8">No messages yet.</p>
        )}
        {thread.messages.map((m) => (
          <div
            key={m.id}
            className={cn('flex', m.direction === 'out' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[78%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug whitespace-pre-line',
                m.direction === 'out'
                  ? 'bg-teal-500 text-white rounded-br-sm'
                  : 'bg-muted text-foreground rounded-bl-sm',
              )}
            >
              {m.body}
              <span
                className={cn(
                  'block text-[9px] mt-0.5 text-right',
                  m.direction === 'out' ? 'text-white/70' : 'text-muted-foreground',
                )}
              >
                {fmtTime(m.occurredAt)}
                {m.direction === 'out' && m.status === 'failed' && ' · failed'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Reply box */}
      <div className="border-t border-border/60 p-2.5">
        {recentlyMessaged && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-1.5 inline-flex items-center gap-1">
            <Clock className="w-3 h-3" /> You messaged this number in the last 5 min — another send
            will be spaced out.
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void onSend();
              }
            }}
            rows={2}
            maxLength={1000}
            placeholder={thread.optedOut ? 'Parent opted out — replies still send if you confirm' : 'Type a reply…'}
            className="flex-1 resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={sending || !draft.trim()}
            className="h-9 px-3 rounded-md bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-50 inline-flex items-center gap-1 text-xs font-semibold shrink-0"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {draft.length}/1000 · sends within 1–2 min (human-paced)
        </p>
      </div>
    </div>
  );
}
