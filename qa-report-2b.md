# QA Report — Task 2-b (Live config + API contract tests)

Agent: qa-live-config · Date: 2026-09-26 · Scope: READ-ONLY verification (no source or DB changes)

**Result: 32 / 33 checks passed · 1 failure** (profileTest in messenger-test — non-blocking, graceful fallback exists)

Target: https://teantreat.vercel.app · Cookie jar reused: /tmp/tt_admin.txt (valid, HTTP 200 on /api/admin/settings)

---

## A) Production webhook + config contract (live curl)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| A1 | Webhook GET handshake, correct token `my_shop_verify_99` | ✅ PASS | `GET /api/webhook/messenger?hub.mode=subscribe&hub.verify_token=my_shop_verify_99&hub.challenge=QA_1790409571_x9f` → **HTTP 200**, body echoed the challenge **exactly**: `QA_1790409571_x9f` |
| A2 | Webhook GET handshake, wrong token | ✅ PASS | `verify_token=WRONG_qa_token_000` → **HTTP 403**, body `{"ok":false,"error":"Verification failed"}` |
| A3a | `meta.verifyTokenInfo.source === 'admin'` | ✅ PASS | source=`admin`, tail `…y_99` (masked; last 4 only) |
| A3b | `meta.tokenInfo.source === 'admin'` | ✅ PASS | source=`admin`, tail `…XQZDZD` (masked) |
| A3c | `webhookUrl` ends with `/api/webhook/messenger` | ✅ PASS | `https://teantreat.vercel.app/api/webhook/messenger` |
| A3d | `meta.metaEnv.verifyToken === true` | ✅ PASS | `metaEnv: { pageToken:true, pageId:true, verifyToken:true, appSecret:false }` |
| A4 | `POST /api/admin/messenger-test` (diagnostic; sent 1 real test message — expected) | ✅ 5/6 sub-checks | `ok:true` · `tokenTest.ok:true` (pageName "My page", **pageId `1372280469293785`** ✅, **pageUsername `teamypage`** ✅, isPageToken:true) · `sendProbe.ok:true` (psid 2858…479) · `lastVerifyAt` present (`2026-09-26T07:59:31.743Z`) · **`profileTest.ok:false` ❌ — see Failure 1** |
| A5 | `GET /api/admin/messenger-menu-status` (route exists at `src/app/api/admin/messenger-menu-status/route.ts`) | ✅ PASS | HTTP 200 · `ok:true` · `meta.ok:true` · **`inSync:true`** · 6 buttons (🍕 মেনু, 🔥 অফার, 📍 লোকেশন, ☎ হেল্পলাইন, rakib button, rakib 2 button) · `hasGetStarted:true` |

## B) Code contract checks (file reads only)

| # | Check | Result | File:line |
|---|-------|--------|-----------|
| B1.1 | Webhook GET uses `await verifyToken()` (DB setting first, then env) | ✅ PASS | `src/app/api/webhook/messenger/route.ts:85` |
| B1.2 | Reaction branch (`event.message_reactions`) sends `sendQuickReplies(psid, t(lang,'homeMenuText'), botQuickReplies(lang))` | ✅ PASS | route.ts:417–423 (esp. 420) |
| B1.3 | No-text attachment/sticker branch sends home menu (same call) | ✅ PASS | route.ts:493–499 (esp. 497) |
| B1.4 | Greeting branch (`isGreetingText`) sends menu buttons (`t(lang,'greetMenuText')` + `botQuickReplies`) | ✅ PASS | route.ts:513–519 (esp. 515) |
| B1.5 | Free-text fallback uses `buildStaticReply(...)` + `sendQuickReplies(..., botQuickReplies(lang))` | ✅ PASS | route.ts:533–535 |
| B1.6 | `is_echo` ignored (early return, never self-reply) | ✅ PASS | route.ts:413 |
| B1.7 | `mid` dedup exists | ✅ PASS | route.ts:159–171 in-memory `seenMids` (10-min window) **+** route.ts:190–205 cross-instance DB guard `isDuplicateCustomerMessage` (60 s, free-text only, button taps exempt at 484–487) |
| B2.1 | `verifyToken()` reads `SETTING_KEYS.META_VERIFY_TOKEN` first, then env `META_VERIFY_TOKEN` | ✅ PASS | `src/lib/messenger.ts:103–111` (105–106 admin setting, 110 env) |
| B2.2 | `sendText` markdown→plain→no-chips triple fallback | ✅ PASS | messenger.ts:376 (markdown) → 379 (plain+chips) → 383 (chips stripped if chips were present) |
| B2.3 | `sendQuickReplies` caps 11 chips, titles sliced to 20 chars | ✅ PASS | messenger.ts:444–446 (`slice(0, 11)`, `title.slice(0, 20)`, payload ≤1000) — same caps also in sendText (345–349) and carousel (511–512) |
| B3.1 | Settings PUT validates `SETTING_KEYS.META_VERIFY_TOKEN` at 6–128 chars | ✅ PASS | `src/app/api/admin/settings/route.ts:85–92` (line 89: `< 6 || > 128` → 400; whitespace/ZWSP stripped) |
| B3.2 | Settings GET returns `verifyTokenInfo` | ✅ PASS | settings/route.ts:32 (`verifyTokenInfo: await verifyTokenInfo()` inside `meta`) |
| B4.1 | `🔐 Webhook Verify Token` UI block | ✅ PASS | `src/app/admin/page.tsx:5305` (block starts 5302) |
| B4.2 | `saveVerifyToken` function (with `clear` mode) | ✅ PASS | admin/page.tsx:4756 (save/clear used at 5337/5341) |
| B4.3 | Placeholder references `my_shop_verify_99` | ✅ PASS | admin/page.tsx:5332 `placeholder="যেমন: my_shop_verify_99"` |
| B4.4 | `verifyTokenInfo` badges (admin/env/none + tail) | ✅ PASS | admin/page.tsx:5308–5318, 5340–5342, 5361 |
| B5.1 | `customers/[id]/message` calls `lastSendErrorWithHint()` on send failure | ✅ PASS | `src/app/api/admin/customers/[id]/message/route.ts:32–35` (`if (!sent)` → line 34) |
| B5.2 | `personal-blast` calls `lastSendErrorWithHint()` on send failure | ✅ PASS | `src/app/api/admin/customers/personal-blast/route.ts:85–95` (`if (!via)` → line 88) |
| B6 | Customer DELETE `$transaction`: chatMessage → referralToken → birthdayClaim → (unlink old claims) → customer delete | ✅ PASS | `src/app/api/admin/customers/[id]/route.ts:72–80`; same-PSID returns fresh: PSID-scoped rows wiped + new C-code on next webhook upsert (webhook route.ts:295 `code: await nextCustomerCode()`) |

## C) Local runtime smoke test

- **Dev server is NOT running** — not started (per QA rules).
  - No `/home/z/my-project/dev.log` exists.
  - `curl http://localhost:3000/` → connection refused (curl exit 7); `/api/health` unreachable.
  - No `next dev`/`next-server` process found; nothing listening on port 3000.
- No local handshake behavior could be observed; production behavior (A1/A2) stands in as the authoritative contract result.

---

## Failures (1)

### Failure 1 — `profileTest.ok:false` in `POST /api/admin/messenger-test` (A4)
- **Observed**: `profileTest = { ok:false, name:null, error:"Unsupported get request. Object with ID '28582468018052479' does not exist, cannot be loaded due to missing permissions, or does not support this operation…" }`
- **Where it comes from**: `messenger-test/route.ts:21–36` probes the newest chatting customer's profile via `fetchMessengerProfile()` → `GET graph.facebook.com/{psid}?fields=first_name,last_name,profile_pic` with the page token (`messenger.ts:249–282`).
- **Impact**: **Non-blocking.** The same PSID's `sendProbe.ok:true` (send works), token test passes, webhook verified. Code already degrades gracefully: on profile failure `upsertCustomer` never wipes an existing stored name (webhook route.ts:284–292) and never uses a placeholder greeting.
- **Likely cause**: Meta restricts profile reads for some PSIDs (e.g., profile cached from an older app-scoped conversation, or missing Pages user-profile permission scope for that user). Also note the 60 s profile-fail cache masks intermittent recovery in diagnostics.
- **Suggested next action (owner/feature agent)**: re-test with a freshly-messaged customer; if it persists, check the app's `pages_user_profile` / `pages_messaging` advanced access, or surface profileTest as a warning-level badge instead of an error in the admin panel.

---

## Notes / rules compliance
- Token values never printed: only masked tails (`…y_99`, `…XQZDZD`) from already-masked API fields.
- Only POSTs performed: `/api/admin/login` was **not** needed (existing jar valid); `/api/admin/messenger-test` (1 diagnostic test message, expected). No settings writes, no DELETEs, no DB changes, no source changes.
- Cookie jar `/tmp/tt_admin.txt` reused successfully (no re-login required; `/tmp/qa_admin.txt` not created).
