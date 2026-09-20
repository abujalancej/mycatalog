import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  // The development HMR fetch cache clones large responses from the local
  // Flask service and can trigger UND_ERR_RES_CONTENT_LENGTH_MISMATCH.
  // These requests already use cache: "no-store", so the HMR copy is not
  // useful for this desktop app.
  experimental: {
    serverComponentsHmrCache: false
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
      { protocol: "https", hostname: "i.discogs.com" },
      { protocol: "https", hostname: "st.discogs.com" },
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "books.googleusercontent.com" },
      { protocol: "https", hostname: "imagessl7.casadellibro.com" },
      { protocol: "https", hostname: "nordicalibros.com" },
      { protocol: "http", hostname: "127.0.0.1", port: "5000" },
      { protocol: "http", hostname: "localhost", port: "5000" }
    ]
  }
};

export default nextConfig;
