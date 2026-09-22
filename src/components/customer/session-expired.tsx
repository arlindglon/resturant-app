'use client'

// Shared "session invalid / expired" screen — used by menu, cart and bill pages.
import Link from 'next/link'
import { QrCode } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function SessionExpiredScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm border-amber-200 shadow-lg shadow-amber-100/50">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-amber-100">
              <QrCode className="size-8 text-amber-600" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-bold text-stone-900">সেশন বাতিল</h1>
              <p className="text-sm leading-relaxed text-stone-500">
                আপনার সেশন শেষ হয়ে গেছে বা টেবিল ক্লিয়ার করা হয়েছে। অনুগ্রহ করে টেবিলের QR আবার স্ক্যান করুন।
              </p>
            </div>
            <Button asChild className="h-11 w-full bg-amber-500 text-base font-bold text-white hover:bg-amber-600">
              <Link href="/">
                <QrCode className="size-4" />
                আবার স্ক্যান করুন
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
