import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      canvas: { browser: '' },
    },
  },
  async redirects() {
    // Legacy URLs from the pre-E.5 split (Insights → Sheet subtab and the
    // dedicated /algorithm/sheets dashboard). Both consolidate into /sheets.
    // `/algorithm?tab=sheet` is handled in src/app/algorithm/page.tsx since
    // Next.js `redirects()` only matches paths, not query strings.
    return [
      {
        source: '/algorithm/sheets',
        destination: '/sheets',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
