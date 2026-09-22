'use client'
// Cart store — persisted in localStorage per device
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CartAddon {
  name: string
  price: number
}

export interface CartItem {
  cartId: string // unique per customization
  itemId: string
  name: string
  basePrice: number
  price: number // with happy hour
  imageUrl: string | null
  quantity: number
  spiceLevel: string | null
  addons: CartAddon[]
  specialNote: string
}

interface CartState {
  items: CartItem[]
  appliedVoucher: { code: string; discount: number; title: string } | null
  addItem: (item: Omit<CartItem, 'cartId'>) => string
  updateQuantity: (cartId: string, delta: number) => void
  removeItem: (cartId: string) => void
  setVoucher: (v: { code: string; discount: number; title: string } | null) => void
  clear: () => void
  subtotal: () => number
}

function unitPrice(i: CartItem) {
  return i.price + i.addons.reduce((s, a) => s + a.price, 0)
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      appliedVoucher: null,
      addItem: (item) => {
        const cartId = `${item.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        set((s) => ({ items: [...s.items, { ...item, cartId }] }))
        return cartId
      },
      updateQuantity: (cartId, delta) =>
        set((s) => ({
          items: s.items
            .map((i) => (i.cartId === cartId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
            .filter((i) => i.quantity > 0),
        })),
      removeItem: (cartId) => set((s) => ({ items: s.items.filter((i) => i.cartId !== cartId) })),
      setVoucher: (v) => set({ appliedVoucher: v }),
      clear: () => set({ items: [], appliedVoucher: null }),
      subtotal: () => Math.round(get().items.reduce((s, i) => s + unitPrice(i) * i.quantity, 0) * 100) / 100,
    }),
    { name: 'qr_cart' }
  )
)

export { unitPrice }
