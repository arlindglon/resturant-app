// PUBLIC /datadel-page — ডেটা ডিলিট নির্দেশনা (Meta/data-deletion compliance page)
import type { Metadata } from 'next'

import { LegalShell, LegalList, LegalSection } from '@/components/customer/legal-shell'
import { SETTING_KEYS } from '@/lib/constants'
import { getSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const name = await getSetting(SETTING_KEYS.RESTAURANT_NAME)
  const restaurantName = (name || 'Smart QR Restaurant').trim()
  return {
    title: `${restaurantName} — ডেটা ডিলিট নির্দেশনা`,
    description: `${restaurantName}-এর QR অর্ডারিং সেবা থেকে আপনার ব্যক্তিগত তথ্য মুছে ফেলার অনুরোধ করার নিয়ম।`,
  }
}

export default function DataDeletionPage() {
  return (
    <LegalShell
      title="🗑️ ডেটা ডিলিট নির্দেশনা"
      intro="আপনি চাইলে আমাদের সিস্টেমে থাকা আপনার ব্যক্তিগত তথ্য মুছে ফেলার অনুরোধ করতে পারেন। নিচে প্রক্রিয়াটি ধাপে ধাপে বর্ণনা করা হলো।"
    >
      <LegalSection title="📦 আমাদের কাছে আপনার কী তথ্য থাকে">
        <LegalList
          items={[
            'ডিভাইস আইডি (অর্ডার ও কুপন যাচাইয়ের জন্য — কোনো নাম ছাড়াই)।',
            'অর্ডার ও বিলের তথ্য: টেবিল নম্বর, খাবারের তালিকা, সময় ও পরিমাণ।',
            'আপনি দিয়ে থাকলে: নাম, ফোন নম্বর বা জন্মদিন (জন্মদিন/অকেশন অফারের জন্য)।',
            'জিওফেন্স যাচাইয়ের সময় ব্যবহৃত লোকেশন — অর্ডারের সাথে সংরক্ষণ করা হয় না।',
          ]}
        />
      </LegalSection>

      <LegalSection title="📮 কীভাবে ডিলিট অনুরোধ করবেন">
        <p className="font-bold text-stone-700">উপায় ১ — মেসেঞ্জারে মেসেজ (সবচেয়ে সহজ):</p>
        <LegalList
          items={[
            'নিচের “মেসেঞ্জারে মেসেজ দিন” বাটনে ক্লিক করুন অথবা রেস্টুরেন্টের ফেসবুক পেজে যান।',
            'মেসেজে লিখুন “ডেটা ডিলিট করুন” এবং আপনার ফোন নম্বর বা রসিদ নম্বর দিন।',
          ]}
        />
        <p className="mt-3 font-bold text-stone-700">উপায় ২ — রেস্টুরেন্টে সরাসরি:</p>
        <LegalList
          items={[
            'রেস্টুরেন্টে এসে স্টাফ/ম্যানেজারকে বলুন আপনার ডেটা মুছতে চান।',
            'শনাক্ত করতে ফোন নম্বর বা পুরনো রসিদ দেখালে অনুরোধটি দ্রুত প্রসেস হবে।',
          ]}
        />
      </LegalSection>

      <LegalSection title="⏳ কত সময় লাগবে">
        <p>
          অনুরোধ পাওয়ার <span className="font-bold text-stone-700">৭ (সাত) দিনের মধ্যে</span> আমরা
          আপনার ব্যক্তিগত তথ্য মুছে ফেলি এবং মেসেজে কনফার্মেশন জানিয়ে দিই।
        </p>
      </LegalSection>

      <LegalSection title="✂️ কী মুছে যাবে, কী থাকবে">
        <LegalList
          items={[
            'মুছে যাবে: নাম, ফোন নম্বর, জন্মদিন ও ডিভাইস আইডি-সংযুক্ত ব্যক্তিগত তথ্য।',
            'সীমিতভাবে থাকতে পারে: আইনি ও হিসাবের প্রয়োজনে বিল/রসিদের সংখ্যা ও পরিমাণ (কোনো ব্যক্তিগত পরিচয় ছাড়া) — যেমন করের রেকর্ড।',
            'মুছে ফেলার পরেও আপনি স্বাভাবিকভাবে QR স্ক্যান করে অর্ডার করতে পারবেন — এটি কোনো অ্যাকাউন্ট বাতিল করে না।',
          ]}
        />
      </LegalSection>

      <LegalSection title="❓ সাধারণ প্রশ্ন">
        <LegalList
          items={[
            'ডিলিট করলে কি কুপন আবার পাবো? — না, প্রতারণা ঠেকাতে কুপনের ডিভাইস-যাচাই রেকর্ড নিরাপদে আলাদা রাখা হয়।',
            'অন্য কারো ডেটা দিয়ে অনুরোধ করা যাবে? — না, শুধু নিজের তথ্যের জন্য অনুরোধ করুন; যাচাইয়ের প্রয়োজন হতে পারে।',
          ]}
        />
      </LegalSection>
    </LegalShell>
  )
}
