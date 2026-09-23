import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NOTE: Vercel এ deploy করার জন্য output: "standalone" দরকার নেই —
  // Vercel নিজেই সব ফাইল অপটিমাইজ করে। তাই এটা বাদ দেওয়া হয়েছে।
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // QR প্রিন্ট কার্ডে বাংলা লেখা রেন্ডার করতে বান্ডিল করা বাংলা ফন্ট লাগবে —
  // Vercel সার্ভারে বাংলা ফন্ট নেই (না দিলে লেখা □□□ বক্স হয়ে যায়)।
  outputFileTracingIncludes: {
    "/api/admin/qrcode": ["./assets/fonts/**"],
  },
};

export default nextConfig;
