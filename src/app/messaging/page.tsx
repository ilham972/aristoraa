'use client';

import Link from 'next/link';
import { Settings as SettingsIcon, Inbox, CalendarDays, Megaphone, MessageSquare, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Section = {
  href: string;
  label: string;
  desc: string;
  icon: typeof SettingsIcon;
  available: boolean;
  available_in?: string;
};

const SECTIONS: Section[] = [
  {
    href: '/messaging/settings',
    label: 'Settings',
    desc: 'Bot connection · send test · webhook config · opt-out list',
    icon: SettingsIcon,
    available: true,
  },
  {
    href: '/messaging',
    label: 'Inbox',
    desc: 'Parent replies · forwarded conversations',
    icon: Inbox,
    available: false,
    available_in: 'W.1.4+',
  },
  {
    href: '/messaging/today',
    label: 'Today',
    desc: 'Absence alerts · "things to send today"',
    icon: CalendarDays,
    available: true,
  },
  {
    href: '/messaging/broadcasts',
    label: 'Broadcasts',
    desc: 'Schedule-change announcements to parent groups',
    icon: Megaphone,
    available: true,
  },
  {
    href: '/messaging',
    label: 'Tomorrow',
    desc: 'Class reminders for tomorrow\'s slots',
    icon: MessageSquare,
    available: false,
    available_in: 'W.4',
  },
  {
    href: '/messaging',
    label: 'Weekly Cards',
    desc: 'Per-student weekly performance reports',
    icon: FileText,
    available: false,
    available_in: 'W.5',
  },
];

export default function MessagingHubPage() {
  return (
    <div className="px-4 pt-6 pb-8 max-w-2xl mx-auto">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Messaging</h1>
        <p className="text-sm text-muted-foreground mt-1">
          WhatsApp bot for parent communication. Inline triggers live on other pages —
          this hub is for batches and settings.
        </p>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const card = (
            <Card
              className={cn(
                'border-border/60 transition-colors',
                s.available
                  ? 'hover:bg-card/70 hover:border-border cursor-pointer'
                  : 'opacity-55',
              )}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-teal-500/15 text-teal-400 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{s.label}</p>
                    {!s.available && s.available_in && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {s.available_in}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {s.desc}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
          return s.available ? (
            <Link key={s.label} href={s.href}>
              {card}
            </Link>
          ) : (
            <div key={s.label}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
