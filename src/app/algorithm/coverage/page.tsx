// Retired 2026-07-17. This route was a 258-line copy of the Coverage tab in
// /algorithm — same query, same UI, drifting separately, and nothing linked to
// it. The tab is the single home now (and it grew a Groups lens: per-group term
// coverage). Kept as a redirect only so an old bookmark still lands somewhere
// sensible; the concept-stock audit this page used to show is the "bank" lens.

import { redirect } from 'next/navigation';

export default async function RetiredCoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ g?: string; t?: string }>;
}) {
  const { g, t } = await searchParams;
  const params = new URLSearchParams({ tab: 'coverage', lens: 'bank' });
  if (g) params.set('g', g);
  if (t) params.set('t', t);
  redirect(`/algorithm?${params.toString()}`);
}
