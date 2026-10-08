import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Build to plain static files in out/, which the iPhone app bundles and runs offline.
  output: "export",
  // Directory-style URLs (settings/index.html) so links work inside the app's file server.
  trailingSlash: true,
  images: { unoptimized: true },
};

export default config;
