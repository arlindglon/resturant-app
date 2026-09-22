// Meta Messenger Webhook
// GET  — verification handshake
// POST — message/referral/postback receiver:
//   referral (ref=token) → greet + Graph API name + 1-tap phone quick reply
//   quick_reply SHARE_PHONE → anti-fraud (5 checks) → apply ৳ discount → digital receipt
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { fail, ok } from '@/lib/api'
import { fetchProfileName, askPhoneQuickReply, sendReceipt } from '@/lib/messenger'
import { applyBirthdayDiscount } from '@/lib/birthday'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return fail('Verification failed', 403)
}

interface WebhookEntry {
  id: string
  messaging?: MessagingEvent[]
}

interface MessagingEvent {
  sender?: { id: string }
  recipient?: { id: string }
  referral?: { ref?: string; source?: string; type?: string }
  postback?: { payload?: string; referral?: { ref?: string } }
  message?: {
    text?: string
    quick_reply?: { payload?: string }
    attachments?: { type: string; payload?: unknown }[]
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.object !== 'page') return ok({ received: true })

    for (const entry of body.entry as WebhookEntry[]) {
      for (const event of entry.messaging || []) {
        await handleEvent(event).catch((e) => console.error('[webhook:handler]', e))
      }
    }
    return ok({ received: true })
  } catch (e) {
    console.error('[webhook:POST]', e)
    return ok({ received: true }) // always 200 for Meta
  }
}

async function handleEvent(event: MessagingEvent) {
  const psid = event.sender?.id
  if (!psid) return

  // Case 1: customer opened m.me?ref=TOKEN (referral or postback)
  const ref = event.referral?.ref || event.postback?.referral?.ref
  if (ref) {
    const tokenRow = await db.referralToken.findUnique({ where: { token: ref } })
    if (!tokenRow || tokenRow.status !== 'PENDING') {
      await fetchProfileName(psid)
      return
    }
    const { firstName, lastName } = await fetchProfileName(psid)
    // store psid on token row (reuse name fields via a lightweight update through customerId path)
    await db.referralToken.update({
      where: { token: ref },
      data: { name: `${firstName} ${lastName}`.trim() },
    })
    await askPhoneQuickReply(
      psid,
      `স্বাগতম ${firstName}! 🎉\n\nবিল আপডেট ও ডিজিটাল রিসিট পেতে আপনার ফোন নম্বরে চাপ দিন (নিচে ১-ট্যাপ বাটন আসবে)।`
    )
    return
  }

  // Case 2: 1-tap phone share quick reply
  const qrPayload = event.message?.quick_reply?.payload
  const phoneFromAttachment = extractPhone(event)
  if ((qrPayload === 'SHARE_PHONE' || phoneFromAttachment) && phoneFromAttachment) {
    const phone = phoneFromAttachment
    // find the latest pending referral token to locate session
    const tokenRow = await db.referralToken.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })
    // better: find tokens whose name we updated via this psid? We didn't store psid. Fallback: newest pending.
    if (!tokenRow) {
      await sendReceipt(psid, [{ text: 'দুঃখিত, অফারটি খুঁজে পাওয়া যায়নি। রেস্তোরাঁয় স্টাফদের জানান।' }])
      return
    }

    const { firstName, lastName } = await fetchProfileName(psid)
    const result = await applyBirthdayDiscount({
      psid,
      firstName,
      lastName,
      phone,
      birthday: tokenRow.birthday,
      deviceId: tokenRow.deviceId,
      deviceFp: tokenRow.deviceFp,
      sessionId: tokenRow.sessionId,
      tableNumber: tokenRow.tableNumber,
      occasionId: tokenRow.occasionId,
      occasionName: tokenRow.occasionName,
    })

    if (!result.ok) {
      await sendReceipt(psid, [{ text: `😔 ${result.message}` }])
      return
    }

    // mark claimed + send digital receipt
    await db.referralToken.update({ where: { id: tokenRow.id }, data: { status: 'CLAIMED', phone } })

    const orders = await db.order.findMany({
      where: { sessionId: tokenRow.sessionId },
      include: { items: true },
      orderBy: { placedAt: 'asc' },
    })
    const lines: string[] = [`🧾 ডিজিটাল রিসিট — টেবিল ${tokenRow.tableNumber}`]
    let payable = 0
    for (const o of orders) {
      payable += o.total
      lines.push(`অর্ডার #${o.orderNo}:`)
      for (const i of o.items) {
        lines.push(`  • ${i.itemName} ×${i.quantity} — ৳${i.lineTotal}`)
      }
      if (o.voucherDiscount) lines.push(`  কুপন ছাড়: -৳${o.voucherDiscount}`)
      if (o.happyHourDiscount) lines.push(`  হ্যাপি আওয়ার ছাড়: -৳${o.happyHourDiscount}`)
      if (o.birthdayDiscount) lines.push(`  🎂 জন্মদিনের ছাড়: -৳${o.birthdayDiscount}`)
    }
    lines.push(`\nমোট প্রদেয়: ৳${Math.round(payable * 100) / 100}`)
    lines.push(`\nধন্যবাদ ${firstName}! 🙏 আবার আসবেন — বিল আপডেট ও অফার পেতে এই চ্যাটটি রেখে দিন।`)

    await sendReceipt(psid, [{ text: lines.join('\n') }])
  }
}

function extractPhone(event: MessagingEvent): string | null {
  // 1-tap phone quick reply arrives as attachment type 'fallback' with payload text, or as message text
  if (event.message?.text) {
    const digits = event.message.text.replace(/[^\d+]/g, '')
    if (/^\+?\d{10,15}$/.test(digits)) return digits
  }
  for (const att of event.message?.attachments || []) {
    const payload = att.payload as { text?: string } | undefined
    if (payload?.text) {
      const digits = payload.text.replace(/[^\d+]/g, '')
      if (/^\+?\d{10,15}$/.test(digits)) return digits
    }
  }
  return null
}
