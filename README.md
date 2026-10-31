# MERA PAISA AI 💰 (Phase 1 + Mera Real QR)

Mobile-first PWA: AI expense tracker (Hindi/Hinglish/English + voice), Demo wallet ledger, Smart Khata, Budget alerts, History (calendar, CSV/PDF), aur **aapka asli UPI QR**.

> ⚠️ App ka sara paisa **Demo / Ledger** hai (andar ka hisaab). Bank balance nahi dikhata (Phase 3).
> QR asli hai: us par aaya paisa seedha aapke bank mein jayega. App use verify nahi kar sakta, isliye
> request **Pending** rehti hai jab tak aap **"Paisa mila"** na dabayein → entry **"Manually confirmed"** banti hai (kabhi "Verified" nahi).

## PC par chalayein
1. Node.js 22.5+ install karein (nodejs.org).
2. Folder mein: `npm install` fir `npm start`
3. Browser: http://localhost:3000 → naam + PIN se account banayein.

Test: `npm test`

## Phone par (same WiFi)
PC ka IP dekhein (`ipconfig`), phone Chrome mein `http://PC-IP:3000` kholein.
(Camera scan aur "Install app" ke liye HTTPS chahiye → neeche wala deploy best hai.)

## Online deploy (phone pe app jaisa)
**Render.com:** New → Web Service → ye folder GitHub par daal kar connect karein
- Build: `npm install` · Start: `npm start`
- Persistent Disk add karein (mount `/data`) aur env `DATA_DIR=/data` (warna restart par data mit jayega)
**Railway.app:** New project → GitHub repo → Volume `/data` + `DATA_DIR=/data`.
Fir phone Chrome mein link kholein → ⋮ → **Add to Home screen**.

Env: `PORT`, `DATA_DIR`, `PAYMENT_MODE=sandbox`, `SANDBOX_WEBHOOK_SECRET` (badal dein).

## Kya hai
- Home: ledger balance, aaj/mahine ki income-kharcha, bachat, recent, bills, AI insights, budget alerts
- ＋ AI Quick Entry: "Aaj 40 rupaye aloo liya aur 30 rupaye tamatar" → 2 entries, confirm ke baad save; 🎤 voice (Chrome)
- Scan & QR: UPI ID se QR / purana QR photo upload (decode), amount wala QR + pay link, payment requests, camera Scan & Pay (UPI app khulta hai)
- Wallet: Demo add/withdraw, received/sent, Smart Khata (udhaar, partial wapsi, settlement), budgets 80/90/100%
- Profile: Hindi/English, dark/light, categories, PIN badlein, backup/restore JSON, audit log
- Offline: entries phone mein queue, net aane par sync (duplicate nahi banti)
- Security: PIN scrypt hash, lockout, UPI PIN/OTP kabhi nahi, secrets sirf server par

## Aage (Phase 2-5)
`lib/provider.js` mein payment-provider interface + `/api/provider/sandbox/webhook` (HMAC signature + idempotency) ready hai.
Razorpay/Cashfree jaise licensed provider ke onboarding ke baad live adapter lagega — tabhi "Verified" status aayega.
