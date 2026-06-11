'use client';

import { Show } from '@clerk/nextjs';
import { useAuth } from '@clerk/nextjs';
import { BottomNav } from '@/components/navigation';
import { NavVisibilityProvider } from '@/contexts/nav-visibility';
import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

function SignedOutRedirect({ children }: { children: ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isSignInPage = pathname.startsWith('/sign-in');

  useEffect(() => {
    if (isLoaded && !isSignedIn && !isSignInPage) {
      router.replace('/sign-in');
    }
  }, [isLoaded, isSignedIn, isSignInPage, router]);

  if (!isLoaded) return null;
  if (!isSignedIn && !isSignInPage) return null;

  return <>{children}</>;
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in">
        <NavVisibilityProvider>
          <main className="pb-20 min-h-screen">
            {children}
          </main>
          <BottomNav />
        </NavVisibilityProvider>
      </Show>
      <Show when="signed-out">
        <SignedOutRedirect>{children}</SignedOutRedirect>
      </Show>
    </>
  );
}
