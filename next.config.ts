import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Phone photos (interview docs, field photos) routinely run 5-15MB
      // at full resolution.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
