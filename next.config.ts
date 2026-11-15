import type { NextConfig } from "next";

/** Hostname of PUBLIC_URL (the HTTPS tunnel), if set. */
function publicHost(): string[] {
  try {
    return process.env.PUBLIC_URL ? [new URL(process.env.PUBLIC_URL).hostname] : [];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // Phone /hunter, Watch and Shortcuts reach `next dev` through a cloudflared quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com", ...publicHost()],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
