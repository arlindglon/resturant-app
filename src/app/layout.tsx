import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { getSetting } from "@/lib/settings";
import { SETTING_KEYS } from "@/lib/constants";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Page title follows the admin panel: "<রেস্টুরেন্টের নাম> — <title_suffix>"
export async function generateMetadata(): Promise<Metadata> {
  const [name, suffix, logo] = await Promise.all([
    getSetting(SETTING_KEYS.RESTAURANT_NAME),
    getSetting(SETTING_KEYS.TITLE_SUFFIX),
    getSetting(SETTING_KEYS.RESTAURANT_LOGO_URL),
  ])
  const restaurantName = name || "Smart QR Restaurant"
  const titleSuffix = suffix || "Smart Restaurant System"
  return {
    title: `${restaurantName} - ${titleSuffix}`,
    description: `${restaurantName} — Smart QR Restaurant Management, Sales Engine & CRM — স্ক্যান করুন, অর্ডার করুন, উপভোগ করুন!`,
    icons: logo ? { icon: logo } : { icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="bn" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <SonnerToaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
