'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardPen, Trophy, Users, Settings, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavVisibility } from '@/contexts/nav-visibility';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';

type NavItem = { href: string; label: string; icon: typeof ClipboardPen; leadOnly?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: '/score-entry', label: 'Scores', icon: ClipboardPen },
  { href: '/lead', label: 'Lead', icon: Radio, leadOnly: true },
  { href: '/leaderboard', label: 'Board', icon: Trophy },
  { href: '/students', label: 'Students', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const { hideBottomNav } = useNavVisibility();
  const { role, teacher } = useCurrentTeacher();

  if (hideBottomNav) return null;

  // Show Lead tab when user is a Lead or Admin. If no teacher record exists
  // (pre-bootstrap), show it so the first admin can reach the page.
  const canSeeLead = !teacher || role === 'lead' || role === 'admin';
  const items = NAV_ITEMS.filter((i) => !i.leadOnly || canSeeLead);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {items.map(item => {
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-1.5 px-3 rounded-xl transition-all min-w-[56px]',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <div className={cn(
                'relative flex items-center justify-center w-10 h-7 rounded-lg transition-all',
                isActive && 'bg-primary/12'
              )}>
                <item.icon
                  className={cn(
                    'w-[20px] h-[20px] transition-all',
                    isActive ? 'stroke-[2.5]' : 'stroke-[1.75]'
                  )}
                />
              </div>
              <span className={cn(
                'text-[10px] leading-none transition-all',
                isActive ? 'font-semibold' : 'font-medium'
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
