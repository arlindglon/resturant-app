// Meta Messenger Graph API helpers (CRM)
const GRAPH = 'https://graph.facebook.com/v21.0'

function pageToken(): string {
  return process.env.META_PAGE_TOKEN || ''
}

export function messengerConfigured(): boolean {
  return Boolean(process.env.META_PAGE_ID && process.env.META_PAGE_TOKEN)
}

/** Fetch first/last name from PSID */
export async function fetchProfileName(psid: string): Promise<{ firstName: string; lastName: string }> {
  const token = pageToken()
  if (!token) return { firstName: 'Customer', lastName: '' }
  try {
    const res = await fetch(`${GRAPH}/${psid}?fields=first_name,last_name&access_token=${token}`, {
      signal: AbortSignal.timeout(10_000),
    })
    const j = await res.json()
    return { firstName: j.first_name || 'Customer', lastName: j.last_name || '' }
  } catch {
    return { firstName: 'Customer', lastName: '' }
  }
}

/** Send a plain text message to a PSID */
export async function sendText(psid: string, text: string): Promise<boolean> {
  const token = pageToken()
  if (!token) return false
  try {
    await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: psid }, message: { text } }),
      signal: AbortSignal.timeout(10_000),
    })
    return true
  } catch {
    return false
  }
}

/** 1-tap phone number quick reply (Messenger shows SIM number above keyboard) */
export async function askPhoneQuickReply(psid: string, text: string): Promise<boolean> {
  const token = pageToken()
  if (!token) return false
  try {
    await fetch(`${GRAPH}/me/messages?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message: {
          text,
          quick_reply: {
            content_type: 'user_phone_number',
            title: '📱 নম্বর শেয়ার করুন',
            payload: 'SHARE_PHONE',
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })
    return true
  } catch {
    return false
  }
}

/** Digital receipt message */
export async function sendReceipt(
  psid: string,
  lines: { text: string }[]
): Promise<boolean> {
  const text = lines.map((l) => l.text).join('\n')
  return sendText(psid, text)
}

/** Birthday greeting + voucher */
export async function sendBirthdayGreeting(psid: string, name: string, voucherCode: string, percent: number) {
  return sendText(
    psid,
    `🎂 শুভ জন্মদিন ${name}!\n\nআপনার জন্য বিশেষ উপহার: কুপন "${voucherCode}" — পরবর্তী অর্ডারে ${percent}% ছাড়!\nআজই ভিজিট করুন এবং উপভোগ করুন। 🎉`
  )
}
