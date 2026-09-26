import type { MetadataRoute } from 'next'

// PWA manifest — iOS 16.4+ ব্রাউজার-পুশ কাজ করাতে হলে কাস্টমারকে সাইটটা
// "Add to Home Screen" করতে হয়; এই manifest ছাড়া iOS-এ পুশ চলে না।
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tea and Treat — Smart QR Restaurant',
    short_name: 'Tea & Treat',
    description: 'স্ক্যান করুন, অর্ডার করুন, উপভোগ করুন — অর্ডার রেডি হলে নোটিফিকেশন পান।',
    start_url: '/menu',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#f59e0b',
    icons: [
      { src: '/icon-64.png', sizes: '64x64', type: 'image/png' },
      { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }
}
