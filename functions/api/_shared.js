// Shared helpers for /api routes — trimmed mirror of unitedtraffictickets.com's
// functions/api/_shared.js, adapted for the sister sites (trafficticketamigo.com
// / trafficticketmama.com). Site identity comes from env.SITE_SOURCE
// ('amigo' | 'mama'); Stripe runs on United's account acct_1U1VzOKjhWqVWzfL.
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      ...extraHeaders,
    },
  });
}

export function rand(n) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function siteSource(env) {
  const s = String((env && env.SITE_SOURCE) || '').trim().toLowerCase();
  return s === 'mama' ? 'mama' : 'amigo';
}

export function trackingPrefix(env) {
  return siteSource(env) === 'mama' ? 'MA' : 'AM';
}

export function siteDomain(env) {
  return siteSource(env) === 'mama' ? 'trafficticketmama.com' : 'trafficticketamigo.com';
}

export function normalizeStripeSecret(value) {
  const raw = String(value || '').trim();
  return raw.replace(/^['"]+|['"]+$/g, '').trim();
}

// Production price IDs on acct_1U1VzOKjhWqVWzfL (same account United uses),
// used only when no STRIPE_PRICE_<SERVICE> override is configured.
const DEFAULT_PRICE_IDS = {
  '999': 'price_1U9tcuKjhWqVWzfLFHVN0IQC',
  '199': 'price_1U9tbmKjhWqVWzfLQQbTtSvD',
};

export function priceFor(service, env) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PRICE_IDS, service)) return null;
  const override = String((env && env['STRIPE_PRICE_' + service]) || '').trim();
  return override || DEFAULT_PRICE_IDS[service];
}

export function statusSummary(status, notes = {}) {
  switch (status) {
    case 'claimed': return 'Your results are saved. Finish the remaining details to continue.';
    case 'payment_pending': return 'Payment not yet completed. Your case is queued and will be drafted once payment clears.';
    case 'payment_complete': return 'Payment received. Your declaration paperwork is being prepared.';
    case 'submitted': return 'Your paperwork has been prepared and is ready for review/submission.';
    case 'awaiting_court': return 'Awaiting the court decision. This can take several months.';
    case 'decided': return 'The court has returned a decision. Details are being sent to your email.';
    default: return 'Status: ' + status;
  }
}

export function statusHistory(status) {
  const map = {
    claimed: ['Claimed'],
    payment_pending: ['Payment', 'Pending'],
    payment_complete: ['Payment', 'Drafting'],
    submitted: ['Payment', 'Drafting', 'Submitted'],
    awaiting_court: ['Payment', 'Drafting', 'Submitted', 'Awaiting Court'],
    decided: ['Payment', 'Drafting', 'Submitted', 'Court Decision'],
  };
  return map[status] || [status];
}

// Derive a stable bearer token from a server-only secret. The raw token never
// needs to be stored in the case record, and access stays scoped to one case.
export async function caseAccessToken(env, trackingCode) {
  const secret = env.CASE_ACCESS_SECRET || env.STRIPE_SECRET_KEY || env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret || !trackingCode) return '';
  const data = new TextEncoder().encode(String(trackingCode) + ':' + secret);
  const mac = await crypto.subtle.digest('SHA-256', data);
  let binary = '';
  for (const b of new Uint8Array(mac)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function hasCaseAccess(request, env, trackingCode) {
  const expected = await caseAccessToken(env, trackingCode);
  if (!expected) return false;
  const url = new URL(request.url);
  const provided = url.searchParams.get('token') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return provided === expected;
}

// KV list() is paginated. Keep following cursors so a listing across a large
// prefix never silently omits keys.
export async function listRecords(env, prefix) {
  const records = [];
  let cursor;
  do {
    const list = await env.CASES.list({ prefix, ...(cursor ? { cursor } : {}) });
    for (const item of list.keys) {
      const r = await env.CASES.get(item.name, 'json');
      if (r) records.push(r);
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return records;
}

// Minimal Resend sender (text only). Returns true only when the provider
// accepted the message. No-ops (returns false) when email is not configured,
// matching United's behavior of logging instead of failing the request.
export async function resendSend(env, { to, subject, text }) {
  if (!env.RESEND_API_KEY) return false;
  const from = env.RESEND_FROM || '';
  if (!from || !to) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) {
    console.error('Resend send failed', res.status, await res.text().catch(() => ''));
    return false;
  }
  return true;
}

export async function sendBusinessNotification(env, { subject, text }) {
  if (!env.RESEND_API_KEY) {
    console.error('Business notification skipped: RESEND_API_KEY is not configured');
    return false;
  }
  const to = env.ADMIN_EMAIL || env.RESEND_FROM_TO || '';
  if (!to) {
    console.error('Business notification skipped: ADMIN_EMAIL/RESEND_FROM_TO is not configured');
    return false;
  }
  try {
    return !!(await resendSend(env, { to, subject, text }));
  } catch (e) {
    console.error('Business notification email failed', e);
    return false;
  }
}
