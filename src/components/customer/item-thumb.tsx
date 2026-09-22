'use client'

// Menu item image with graceful fallback (warm gradient placeholder + icon).
import { useState } from 'react'
import { UtensilsCrossed } from 'lucide-react'

import { cn } from '@/lib/utils'

export function ItemThumb({
  src,
  alt,
  className,
  iconClassName,
}: {
  src: string | null
  alt: string
  className?: string
  iconClassName?: string
}) {
  const [error, setError] = useState(false)

  if (src && !error) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setError(true)}
        className={cn('object-cover', className)}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100',
        className
      )}
    >
      <UtensilsCrossed className={cn('size-8 text-amber-400', iconClassName)} />
    </div>
  )
}
