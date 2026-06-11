'use client';

import { useAuth } from '@clerk/nextjs';
import { BottomNav } from '@/components/navigation';
import { NavVisibilityProvider } from '@/contexts/nav-visibility';
import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// Instant app shell shown while Clerk is still loading/verifying the session
// (perf phase 2, 2026-06-12). Previously this window rendered null — a blank
// screen for the whole auth round trip (2–4s from Sri Lanka). The skeleton is
// purely visual: no Convex queries, no real nav (taps during verification
// would race the redirect), so nothing sensitive can leak to a signed-out eye.
function ShellSkeleton() {
  return (
    <div aria-hidden className="min-h-screen pb-20 animate-pulse">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
        <div className="h-7 w-36 rounded-lg bg-muted" />
        <div className="h-10 rounded-xl bg-muted" />
        <div className="space-y-3 pt-2">
          <div className="h-24 rounded-2xl bg-muted" />
          <div className="h-24 rounded-2xl bg-muted" />
          <div className="h-24 rounded-2xl bg-muted" />
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1 py-1.5">
              <div className="w-9 h-7 rounded-lg bg-muted" />
              <div className="w-8 h-2 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isSignInPage = pathname.startsWith('/sign-in');

  useEffect(() => {
    if (isLoaded && !isSignedIn && !isSignInPage) {
      router.replace('/sign-in');
    }
  }, [isLoaded, isSignedIn, isSignInPage, router]);

  // Sign-in page renders bare regardless of auth state (it handles both).
  if (isSignInPage) return <>{children}</>;

  // Clerk still verifying: instant shell instead of a blank screen.
  if (!isLoaded) return <ShellSkeleton />;

  // Verified signed-out: keep the skeleton up while the redirect lands.
  if (!isSignedIn) return <ShellSkeleton />;

  return (
    <NavVisibilityProvider>
      <main className="pb-20 min-h-screen">{children}</main>
      <BottomNav />
    </NavVisibilityProvider>
  );
}
