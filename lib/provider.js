// Modular payment-provider interface. Only SANDBOX is implemented.
// A live adapter (Razorpay/Cashfree/bank) must implement the same methods and
// is the ONLY thing allowed to create status 'verified' transactions.
const crypto = require('crypto');
class SandboxProvider {
  constructor(secret) { this.name = 'sandbox'; this.live = false; this.secret = secret; }
  sign(body) { return crypto.createHmac('sha256', this.secret).update(body).digest('hex'); }
  verifySignature(rawBody, sig) {
    if (!sig) return false;
    const exp = Buffer.from(this.sign(rawBody)); const got = Buffer.from(String(sig));
    return exp.length === got.length && crypto.timingSafeEqual(exp, got);
  }
  // normalise provider payload -> common event
  parseEvent(json) {
    return { eventId: json.id, type: json.event, amount: Number(json.amount), upiRef: json.upi_ref || null, payer: json.payer || null, requestId: json.request_id || null, at: json.at || null };
  }
}
function getProvider() {
  const mode = process.env.PAYMENT_MODE || 'sandbox';
  if (mode !== 'sandbox') throw new Error('Live provider configured nahi hai. Sandbox mode use karein.');
  return new SandboxProvider(process.env.SANDBOX_WEBHOOK_SECRET || 'sandbox-dev-secret');
}
module.exports = { getProvider, SandboxProvider };
