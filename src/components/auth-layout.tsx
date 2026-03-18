'use client';

import { Show } from '@clerk/nextjs';
import { TopHeader } from '@/components/top-header';
import { BottomNav } from '@/components/navigation';
import { ReactNode } from 'react';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">
        <TopHeader />
        <main className="pb-20 min-h-[calc(100vh-3.5rem)]">
          {children}
        </main>
        <BottomNav />
      </Show>
      <Show when="signed-out">
        {children}
      </Show>
    </>
  );
}
