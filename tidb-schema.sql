-- ============================================================
--  Smart QR Restaurant — TiDB Cloud / MySQL Schema (১৯টা টেবিল)
--  ============================================================
--  📖 এই ফাইল কীভাবে ব্যবহার করবেন (বিস্তারিত: README.md → "ধাপ ৩"):
--   ১) TiDB Cloud এ লগইন করুন  →  আপনার Cluster খুলুন
--   ২) বাম মেনু থেকে "SQL Console" খুলুন
--   ৩) এই ফাইলের সব লেখা (নিচের অংশসহ) কপি করে কনসোলে পেস্ট করুন
--   ৪) Run (বা Ctrl+Enter) চাপুন  →  সব টেবিল তৈরি হয়ে যাবে ✅
--  ============================================================
--  নোট: এই SQL টি প্রজেক্টের prisma/schema.prisma থেকে তৈরি।
--  CREATE TABLE IF NOT EXISTS ব্যবহার করা হয়েছে — তাই একাধিকবার
--  চালালেও সমস্যা নেই (আগে থেকে থাকা টেবিল স্কিপ হবে)।
-- ============================================================

CREATE DATABASE IF NOT EXISTS smart_qr_rest DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_qr_rest;

-- CreateTable
CREATE TABLE IF NOT EXISTS `tables` (
    `id` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `seats` INTEGER NOT NULL DEFAULT 4,
    `status` VARCHAR(191) NOT NULL DEFAULT 'FREE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tables_number_key`(`number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `table_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `tableId` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NOT NULL,
    `clearedAt` DATETIME(3) NULL,
    `scannedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `birthdayGranted` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `table_sessions_token_key`(`token`),
    INDEX `table_sessions_tableId_idx`(`tableId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `session_devices` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `deviceFp` VARCHAR(191) NULL,
    `firstSeen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `session_devices_deviceId_idx`(`deviceId`),
    UNIQUE INDEX `session_devices_sessionId_deviceId_key`(`sessionId`, `deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `deviceFp` VARCHAR(191) NULL,
    `tableNumber` INTEGER NULL,
    `payload` TEXT NULL,
    `prevHash` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ledger_entries_seq_key`(`seq`),
    UNIQUE INDEX `ledger_entries_hash_key`(`hash`),
    INDEX `ledger_entries_type_idx`(`type`),
    INDEX `ledger_entries_deviceId_idx`(`deviceId`),
    INDEX `ledger_entries_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `categories` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `menu_items` (
    `id` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `price` DOUBLE NOT NULL,
    `imageUrl` TEXT NULL,
    `isAvailable` BOOLEAN NOT NULL DEFAULT true,
    `isSetMenu` BOOLEAN NOT NULL DEFAULT false,
    `spiceLevels` VARCHAR(191) NULL,
    `addons` TEXT NULL,
    `upsellIds` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `menu_items_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `happy_hours` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `discountPercent` DOUBLE NOT NULL,
    `daysOfWeek` VARCHAR(191) NOT NULL DEFAULT '[]',
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `itemIds` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `vouchers` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `discountType` VARCHAR(191) NOT NULL,
    `discountValue` DOUBLE NOT NULL,
    `maxDiscount` DOUBLE NULL,
    `minOrderAmount` DOUBLE NOT NULL DEFAULT 0,
    `ruleType` VARCHAR(191) NOT NULL DEFAULT 'GENERAL',
    `startTime` VARCHAR(191) NULL,
    `endTime` VARCHAR(191) NULL,
    `daysOfWeek` VARCHAR(191) NULL,
    `specificDate` DATETIME(3) NULL,
    `setMenuIds` TEXT NULL,
    `minQuantity` INTEGER NULL,
    `usageLimit` INTEGER NULL,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `singleUse` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `vouchers_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `voucher_uses` (
    `id` VARCHAR(191) NOT NULL,
    `voucherId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `deviceId` VARCHAR(191) NULL,
    `deviceFp` VARCHAR(191) NULL,
    `tableNumber` INTEGER NULL,
    `orderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `voucher_uses_voucherId_idx`(`voucherId`),
    INDEX `voucher_uses_deviceId_idx`(`deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `orders` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` INTEGER NOT NULL AUTO_INCREMENT,
    `tableId` VARCHAR(191) NOT NULL,
    `tableNumber` INTEGER NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PLACED',
    `subtotal` DOUBLE NOT NULL,
    `happyHourDiscount` DOUBLE NOT NULL DEFAULT 0,
    `voucherDiscount` DOUBLE NOT NULL DEFAULT 0,
    `birthdayDiscount` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL,
    `voucherCode` VARCHAR(191) NULL,
    `billPaid` BOOLEAN NOT NULL DEFAULT false,
    `paidAt` DATETIME(3) NULL,
    `paymentMethod` VARCHAR(191) NULL,
    `placedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cookingAt` DATETIME(3) NULL,
    `readyAt` DATETIME(3) NULL,
    `servedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `orders_orderNo_key`(`orderNo`),
    INDEX `orders_status_idx`(`status`),
    INDEX `orders_tableId_idx`(`tableId`),
    INDEX `orders_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `order_items` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `unitPrice` DOUBLE NOT NULL,
    `basePrice` DOUBLE NOT NULL,
    `quantity` INTEGER NOT NULL,
    `spiceLevel` VARCHAR(191) NULL,
    `addons` TEXT NULL,
    `specialNote` VARCHAR(191) NULL,
    `lineTotal` DOUBLE NOT NULL,

    INDEX `order_items_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `waiter_calls` (
    `id` VARCHAR(191) NOT NULL,
    `tableId` VARCHAR(191) NOT NULL,
    `tableNumber` INTEGER NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `waiter_calls_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `customers` (
    `id` VARCHAR(191) NOT NULL,
    `psid` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NOT NULL,
    `birthday` DATETIME(3) NULL,
    `discountClaimed` BOOLEAN NOT NULL DEFAULT false,
    `claimedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customers_psid_key`(`psid`),
    UNIQUE INDEX `customers_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `birthday_claims` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `psid` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `deviceFp` VARCHAR(191) NULL,
    `tableNumber` INTEGER NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `birthday_claims_psid_idx`(`psid`),
    INDEX `birthday_claims_phone_idx`(`phone`),
    INDEX `birthday_claims_deviceId_idx`(`deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `referral_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `birthday` DATETIME(3) NULL,
    `phone` VARCHAR(191) NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `tableNumber` INTEGER NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `deviceFp` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `occasionId` VARCHAR(191) NULL,
    `occasionName` VARCHAR(191) NULL,

    UNIQUE INDEX `referral_tokens_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `imgbb_keys` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `usageCount` INTEGER NOT NULL DEFAULT 0,
    `failCount` INTEGER NOT NULL DEFAULT 0,
    `lastUsedAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `imgbb_keys_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `settings` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `settings_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `occasion_offers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NOT NULL,
    `dateLabel` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `discount` DOUBLE NOT NULL,
    `minBill` DOUBLE NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `receipts` (
    `id` VARCHAR(191) NOT NULL,
    `receiptNo` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` VARCHAR(191) NOT NULL,
    `tableNumber` INTEGER NOT NULL,
    `ordersCount` INTEGER NOT NULL,
    `subtotal` DOUBLE NOT NULL,
    `discountTotal` DOUBLE NOT NULL,
    `total` DOUBLE NOT NULL,
    `paymentMethod` VARCHAR(191) NOT NULL,
    `itemsJson` TEXT NOT NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `receipts_receiptNo_key`(`receiptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `access_keys` (
    `id` VARCHAR(191) NOT NULL,
    `keyCode` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `permissions` TEXT NOT NULL,
    `lifetime` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `access_keys_keyCode_key`(`keyCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `table_sessions` ADD CONSTRAINT `table_sessions_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `tables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `session_devices` ADD CONSTRAINT `session_devices_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `table_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `menu_items` ADD CONSTRAINT `menu_items_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucher_uses` ADD CONSTRAINT `voucher_uses_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `vouchers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `tables`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `table_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `menu_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `waiter_calls` ADD CONSTRAINT `waiter_calls_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `tables`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `birthday_claims` ADD CONSTRAINT `birthday_claims_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- 🔔 Customer Web Push subscriptions (VAPID — কোনো ডকুমেন্ট লাগে না)
-- নতুন ইনস্টলে এই টেবিলও লাগবে; পুরনো সিস্টেমে অ্যাপ নিজেই বানিয়ে নেয়।
-- ============================================================
CREATE TABLE IF NOT EXISTS `push_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(500) NOT NULL,
    `p256dh` TEXT NOT NULL,
    `auth` TEXT NOT NULL,
    `deviceId` VARCHAR(191) NULL,
    `tableNumber` INTEGER NULL,
    `userAgent` TEXT NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY `push_subscriptions_endpoint_key` (`endpoint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE INDEX IF NOT EXISTS `push_subscriptions_deviceId_idx` ON `push_subscriptions`(`deviceId`);
CREATE INDEX IF NOT EXISTS `push_subscriptions_tableNumber_idx` ON `push_subscriptions`(`tableNumber`);
