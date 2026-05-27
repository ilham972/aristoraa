import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      canvas: { browser: '' },
    },
  },
  async redirects() {
    // Retired standalone routes — Sheets / Score / Lead are now per-session
    // tabs reached via /groups → Day view → tap session. Old bookmarks
    // land on the new home so they never 404.
    return [
      {
        source: '/algorithm/sheets',
        destination: '/groups',
        permanent: false,
      },
      {
        source: '/sheets',
        destination: '/groups',
        permanent: false,
      },
      {
        source: '/score-entry',
        destination: '/groups',
        permanent: false,
      },
      {
        source: '/lead',
        destination: '/groups',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
