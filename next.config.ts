import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    localPatterns: [{ pathname: "/brands/**" }],
  },
};

export default nextConfig;
