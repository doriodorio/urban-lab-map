import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's own dev badge defaults to bottom-left, which is exactly where the
  // map's drawing tools sit - it covered the "Point" button. Dev-only, so it
  // was never on the deployed site, but it obstructed every local review of
  // that toolbar. `false` would hide it altogether; errors still surface
  // either way.
  devIndicators: {
    position: "top-right",
  },
  experimental: {
    serverActions: {
      // Phone photos (interview docs, field photos) routinely run 5-15MB
      // at full resolution.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
