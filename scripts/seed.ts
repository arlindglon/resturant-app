// Seed script — demo data for Smart QR Restaurant
// Run: env -u DATABASE_URL bun scripts/seed.ts
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const U = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=600&q=70`

async function main() {
  console.log('🌱 Seeding…')

  // ---- Settings ----
  const settings: Record<string, string> = {
    session_duration_minutes: '90',
    kitchen_delay_alert_minutes: '15',
    birthday_discount_amount: '50',
    birthday_min_bill: '500',
    restaurant_name: 'Spice Garden',
    restaurant_logo_url: '',
    messenger_page_username: 'SpiceGardenBD',
    birthday_timezone: 'Asia/Dhaka',
    currency: '৳',
  }
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  }

  // ---- Tables ----
  const existingTables = await db.restaurantTable.count()
  if (existingTables === 0) {
    for (let i = 1; i <= 8; i++) {
      await db.restaurantTable.create({ data: { number: i, seats: i % 2 === 0 ? 4 : 6 } })
    }
    console.log('✅ 8 tables')
  }

  // ---- ImgBB keys from env ----
  const envKeys = (process.env.IMGBB_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = 0; i < envKeys.length; i++) {
    await db.imgbbKey.upsert({
      where: { key: envKeys[i] },
      update: {},
      create: { key: envKeys[i], label: `Seed Key ${i + 1}` },
    })
  }

  // ---- Categories & Items ----
  if ((await db.category.count()) === 0) {
    const setCat = await db.category.create({ data: { name: '🍱 সেট মেনু', sortOrder: 1 } })
    const burgerCat = await db.category.create({ data: { name: '🍔 বার্গার', sortOrder: 2 } })
    const riceCat = await db.category.create({ data: { name: '🍛 রাইস আইটেম', sortOrder: 3 } })
    const chickenCat = await db.category.create({ data: { name: '🍗 চিকেন', sortOrder: 4 } })
    const drinksCat = await db.category.create({ data: { name: '🥤 ড্রিংকস', sortOrder: 5 } })

    const setA = await db.menuItem.create({
      data: {
        categoryId: setCat.id, name: 'Set A — চিকেন সেট', price: 320,
        description: 'চিকেন ফ্রাই + পলাও + সালাদ + ড্রিংক', imageUrl: U('photo-1504674900247-0877df9cc836'),
        isSetMenu: true, spiceLevels: JSON.stringify(['Mild', 'Medium', 'Hot']),
        addons: JSON.stringify([{ name: 'Extra Sauce', price: 20 }]),
        sortOrder: 1,
      },
    })
    await db.menuItem.create({
      data: {
        categoryId: setCat.id, name: 'Set B — বিরিয়ানি সেট', price: 380,
        description: 'কাচ্চি বিরিয়ানি + বোরহানি + জর্দা', imageUrl: U('photo-1589302168068-964664d93dc0'),
        isSetMenu: true, spiceLevels: JSON.stringify(['Medium', 'Hot']), sortOrder: 2,
      },
    })
    const setC = await db.menuItem.create({
      data: {
        categoryId: setCat.id, name: 'Set C — বার্গার কম্বো', price: 350,
        description: 'চিকেন বার্গার + ফ্রেঞ্চ ফ্রাই + কোল্ড ড্রিংক', imageUrl: U('photo-1568901346375-23c9450c58cd'),
        isSetMenu: true, spiceLevels: JSON.stringify(['Mild', 'Medium']), sortOrder: 3,
      },
    })

    const burger = await db.menuItem.create({
      data: {
        categoryId: burgerCat.id, name: 'বিফ চিজ বার্গার', price: 250,
        description: 'জুসি বিফ প্যাটি, চেডার চিজ, স্পেশাল সস', imageUrl: U('photo-1568901346375-23c9450c58cd'),
        spiceLevels: JSON.stringify(['Mild', 'Medium', 'Hot']),
        addons: JSON.stringify([{ name: 'Extra Cheese', price: 40 }, { name: 'Extra Sauce', price: 20 }, { name: 'Jalapeño', price: 30 }]),
        upsellIds: JSON.stringify([]), sortOrder: 1,
      },
    })
    await db.menuItem.create({
      data: {
        categoryId: burgerCat.id, name: 'চিকেন ক্রিস্পি বার্গার', price: 200,
        description: 'ক্রিস্পি ফ্রাইড চিকেন, লেটুস, মেয়ো', imageUrl: U('photo-1606755962773-d324e0a13086'),
        spiceLevels: JSON.stringify(['Mild', 'Medium', 'Hot']),
        addons: JSON.stringify([{ name: 'Extra Cheese', price: 40 }]), sortOrder: 2,
      },
    })

    await db.menuItem.create({
      data: {
        categoryId: riceCat.id, name: 'কাচ্চি বিরিয়ানি', price: 300,
        description: 'মটন কাচ্চি, আলু ও বোটি সহ', imageUrl: U('photo-1589302168068-964664d93dc0'),
        spiceLevels: JSON.stringify(['Medium', 'Hot']),
        addons: JSON.stringify([{ name: 'Extra Borhani', price: 50 }]), sortOrder: 1,
      },
    })
    await db.menuItem.create({
      data: {
        categoryId: riceCat.id, name: 'চিকেন পলাও', price: 220,
        description: 'সুগন্ধি বাসমতি পলাও ও রোস্টেড চিকেন', imageUrl: U('photo-1631515243349-e0cb75fb8d3a'),
        spiceLevels: JSON.stringify(['Mild', 'Medium']), sortOrder: 2,
      },
    })

    const chicken = await db.menuItem.create({
      data: {
        categoryId: chickenCat.id, name: 'ফ্রাইড চিকেন (৪পিস)', price: 280,
        description: 'মসলায় মাখানো ক্রিস্পি ফ্রাইড চিকেন', imageUrl: U('photo-1626082927389-6cd097cdc6ec'),
        spiceLevels: JSON.stringify(['Mild', 'Medium', 'Hot']),
        addons: JSON.stringify([{ name: 'Extra Sauce', price: 20 }]), sortOrder: 1,
      },
    })
    await db.menuItem.create({
      data: {
        categoryId: chickenCat.id, name: 'চিকেন তন্দুরি', price: 320,
        description: 'ক্লে-ওভেন তন্দুরি, মিন্ট চাটনি সহ', imageUrl: U('photo-1599487488170-d11ec9c172f0'),
        spiceLevels: JSON.stringify(['Medium', 'Hot']), sortOrder: 2,
      },
    })

    const fries = await db.menuItem.create({
      data: {
        categoryId: chickenCat.id, name: 'ফ্রেঞ্চ ফ্রাই', price: 120,
        description: 'পারমেজান হার্ব ফ্রাই', imageUrl: U('photo-1573080496219-bb080dd4f877'),
        spiceLevels: JSON.stringify(['Mild']), sortOrder: 3,
      },
    })
    const coke = await db.menuItem.create({
      data: {
        categoryId: drinksCat.id, name: 'কোকা-কোলা', price: 40,
        description: '১৫০ml ক্যান', imageUrl: U('photo-1554866585-cd94860890b7'), sortOrder: 1,
      },
    })
    await db.menuItem.create({
      data: {
        categoryId: drinksCat.id, name: 'মাল্টা জুস', price: 60,
        description: 'ফ্রেশ মিক্সড ফ্রুট জুস', imageUrl: U('photo-1600271886742-f049cd451bba'), sortOrder: 2,
      },
    })

    // upsell pairings: burger → fries + coke
    await db.menuItem.update({
      where: { id: burger.id },
      data: { upsellIds: JSON.stringify([fries.id, coke.id]) },
    })
    await db.menuItem.update({
      where: { id: chicken.id },
      data: { upsellIds: JSON.stringify([fries.id]) },
    })
    // SETCOMBO voucher uses setA + setC
    await db.voucher.create({
      data: {
        code: 'SETCOMBO', title: '২টি সেট মেনু নিলেই ২০% ছাড়!',
        description: 'Set A বা Set C — মোট ২টি নিলেই ছাড়',
        discountType: 'PERCENT', discountValue: 20,
        ruleType: 'SET_MENU_QTY', setMenuIds: JSON.stringify([setA.id, setC.id]), minQuantity: 2,
      },
    })
    console.log('✅ categories + items + SETCOMBO voucher')
  }

  // ---- Happy Hour ----
  if ((await db.happyHour.count()) === 0) {
    await db.happyHour.create({
      data: {
        name: 'লাঞ্চ হ্যাপি আওয়ার',
        discountPercent: 15,
        daysOfWeek: '[]',
        startTime: '12:00',
        endTime: '16:00',
        active: true,
      },
    })
    console.log('✅ happy hour')
  }

  // ---- Demo vouchers ----
  if ((await db.voucher.count()) === 1) {
    await db.voucher.createMany({
      data: [
        {
          code: 'WELCOME10', title: 'ওয়েলকাম ১০% ছাড়', description: 'সবার জন্য — প্রথম অর্ডারে ১০% ছাড়',
          discountType: 'PERCENT', discountValue: 10, maxDiscount: 150, ruleType: 'GENERAL', usageLimit: 500,
        },
        {
          code: 'LUNCH50', title: '⏰ লাঞ্চ ফ্ল্যাশ ডিল — ৳৫০ ছাড়', description: 'দুপুর ১২টা - ৩টা পর্যন্ত',
          discountType: 'FIXED', discountValue: 50, minOrderAmount: 300,
          ruleType: 'HOT_TIME', startTime: '12:00', endTime: '15:00',
          daysOfWeek: JSON.stringify([0, 1, 2, 3, 4, 5, 6]), usageLimit: 100,
        },
        {
          code: 'FRIDAY20', title: 'জুম্মা স্পেশাল ২০% ছাড়', description: 'শুক্রবারের জন্য বিশেষ',
          discountType: 'PERCENT', discountValue: 20, maxDiscount: 200,
          ruleType: 'SPECIAL_DAY', daysOfWeek: JSON.stringify([5]), usageLimit: 200,
        },
        {
          code: 'FIRST50', title: '🎁 এককালীন ৳৫০ ছাড়', description: 'প্রতি ডিভাইসে একবারই',
          discountType: 'FIXED', discountValue: 50, minOrderAmount: 300,
          ruleType: 'GENERAL', singleUse: true,
        },
      ],
    })
    console.log('✅ demo vouchers')
  }

  const counts = {
    tables: await db.restaurantTable.count(),
    categories: await db.category.count(),
    items: await db.menuItem.count(),
    vouchers: await db.voucher.count(),
    happyHours: await db.happyHour.count(),
    imgbbKeys: await db.imgbbKey.count(),
  }
  console.log('🎉 Seed complete:', counts)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => db.$disconnect())
