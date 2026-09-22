import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: Vercel এ deploy করার জন্য output: "standalone" দরকার নেই —
  // Vercel নিজেই সব ফাইল অপটিমাইজ করে। তাই এটা বাদ দেওয়া হয়েছে।
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
