'use client';

// Legacy /algorithm/sheets — consolidated into the top-level /sheets nav
// in Phase E.5. next.config.ts handles the redirect at the edge; this
// client-side fallback covers the dev-server case where the config hasn't
// been picked up yet.

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function Redirector() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(qs ? `/sheets?${qs}` : '/sheets');
  }, [router, searchParams]);

  return (
    <div className="px-4 pt-5 max-w-lg mx-auto text-sm text-muted-foreground">
      Redirecting to /sheets…
    </div>
  );
}

export default function LegacySheetsPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-5 max-w-lg mx-auto text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Redirector />
    </Suspense>
  );
}
