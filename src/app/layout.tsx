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
// force-dynamic → metadata (tab title + favicon) is resolved on EVERY request,
// so a name/logo change in the admin panel shows up instantly — the old
// build-time values (e.g. "Spice Garden") stay baked forever otherwise.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const [name, suffix, logo] = await Promise.all([
    getSetting(SETTING_KEYS.RESTAURANT_NAME),
    getSetting(SETTING_KEYS.TITLE_SUFFIX),
    getSetting(SETTING_KEYS.RESTAURANT_LOGO_URL),
  ]);
  const restaurantName = (name || "Smart QR Restaurant").trim();
  const titleSuffix = (suffix || "Smart Restaurant System").trim();
  return {
    title: titleSuffix ? `${restaurantName} - ${titleSuffix}` : restaurantName,
    description: `${restaurantName} — Smart QR Restaurant Management, Sales Engine & CRM — স্ক্যান করুন, অর্ডার করুন, উপভোগ করুন!`,
    // logo uploaded in admin → use it as favicon; otherwise the bundled
    // src/app/favicon.ico + icon.png + apple-icon.png are served
    ...(logo ? { icons: { icon: logo, apple: logo } } : {}),
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
