// DeveloperNote — small, tasteful credit line shown on customer-facing
// pages (receipt, landing, bill, cart). Text + optional contact link are
// admin-editable; rendering is toggled by the admin's on/off switch.
export function DeveloperNote({
  text,
  link,
  className = '',
}: {
  text: string
  link?: string
  className?: string
}) {
  const body = text || '🧑‍💻 এই ডিজিটাল সিস্টেমটি ডেভেলপারের তৈরি — এমন সিস্টেম দরকার হলে যোগাযোগ করুন'
  return (
    <p className={className}>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 transition hover:text-amber-600"
        >
          {body}
        </a>
      ) : (
        body
      )}
    </p>
  )
}
