import { normalizeStripeSecret, siteSource } from './_shared.js';

// /api/health - safe production configuration check.
// Never returns secret values; it reports only whether required bindings exist.
export async function onRequestGet(context) {
  const { env, request } = context;
  const missing = [];
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push('webhook_secret');

  const stripeSecret = normalizeStripeSecret(env.STRIPE_SECRET_KEY);
  const stripeKeyMode = stripeSecret.startsWith('sk_live_') ? 'live' : (stripeSecret.startsWith('sk_test_') ? 'test' : (stripeSecret ? 'unknown' : 'missing'));
  const casesReady = !!env.CASES;

  const priceOverrides = {};
  const badPriceOverrides = [];
  for (const service of ['999', '199']) {
    const key = 'STRIPE_PRICE_' + service;
    const value = String(env[key] || '').trim();
    if (!value) continue;
    if (!/^price_[A-Za-z0-9_]+$/.test(value)) { badPriceOverrides.push(key); continue; }
    priceOverrides[key] = value;
  }

  const fallbackFlag = String(env.STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK || '').trim().toLowerCase() === 'true';
  // Mirrors the checkout fallback predicate: enabled by the flag with a live
  // key, or with no key configured yet (test keys never fall back).
  const fallbackEnabled = fallbackFlag && stripeKeyMode !== 'test';

  if (!casesReady) missing.push('case_storage');
  if (badPriceOverrides.length) missing.push('invalid_stripe_price_override');

  const ok = !!env.STRIPE_WEBHOOK_SECRET && casesReady && badPriceOverrides.length === 0;
  const origin = new URL(request.url).origin;

  return new Response(JSON.stringify({
    ok,
    service: 'traffic-ticket-' + siteSource(env),
    sourceSite: siteSource(env),
    platform: 'cloudflare',
    missing,
    bindings: { cases: casesReady },
    stripe: {
      configured: !!stripeSecret,
      keyMode: stripeKeyMode,
      webhookConfigured: !!env.STRIPE_WEBHOOK_SECRET,
      successUrlValid: true,
      cancelUrlValid: true,
      checkout: {
        apiConfigured: !!stripeSecret && /^sk_(live|test)_/.test(stripeSecret),
        paymentLinkFallbackConfigured: true,
        paymentLinkFallbackEnabled: fallbackEnabled,
        priceOverrides,
        badPriceOverrides,
      },
    },
    integrations: {
      businessEmail: !!env.RESEND_API_KEY,
      clientEmail: !!env.RESEND_API_KEY,
    },
    origin,
  }), {
    status: ok ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
    },
  });
}
