const path = require("path");

const isVercel = Boolean(process.env.VERCEL);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" is only for the Docker image; Vercel builds its own serverless output.
  ...(isVercel ? {} : { output: "standalone" }),
  images: {
    domains: [],
  },
  experimental: {
    // Monorepo root so files outside apps/web (scraper prompt YAMLs) can be traced into the bundle.
    outputFileTracingRoot: path.join(__dirname, "../../"),
    outputFileTracingIncludes: {
      "/api/intelligence/prompts": ["../../services/scraper/config/prompts/**/*.yaml"],
    },
  },
};

module.exports = nextConfig;
