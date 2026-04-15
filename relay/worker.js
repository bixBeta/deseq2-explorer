/**
 * DESeq2 ExploreR — Notification Relay
 *
 * Accepts POST /send from the Docker container, validates a relay token,
 * enforces per-recipient rate limiting via KV, then forwards to Resend.
 *
 * Secrets (set via: wrangler secret put <NAME>):
 *   NOTIFY_TOKEN   — shared bearer token the container presents
 *   RESEND_API_KEY — Resend API key (https://resend.com)
 *   FROM_EMAIL     — verified sender address, e.g. "DESeq2 ExploreR <noreply@yourdomain.com>"
 *
 * KV binding (RATE_KV) is used for rate limiting — see wrangler.toml.
 */

const RATE_LIMIT  = 50;     // max emails per recipient per window
const WINDOW_SECS = 86400;  // 24 hours

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health check
    if (request.method === 'GET' && url.pathname === '/ping') {
      return json({ ok: true });
    }

    if (request.method !== 'POST' || url.pathname !== '/send') {
      return json({ error: 'Not found' }, 404);
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    const auth = request.headers.get('Authorization') ?? '';
    if (!env.NOTIFY_TOKEN || auth !== `Bearer ${env.NOTIFY_TOKEN}`) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid JSON' }, 400); }

    const { to, subject, html } = body;
    if (!to || !subject || !html) {
      return json({ error: 'Fields required: to, subject, html' }, 400);
    }

    // Basic email sanity check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ error: 'Invalid to address' }, 400);
    }

    // ── Rate limit (per recipient, fixed window) ─────────────────────────────
    // TTL is set only when the window first opens so the clock doesn't keep
    // sliding forward every time an email is sent.
    const kvKey  = `rl:${to.toLowerCase()}`;
    const current = parseInt((await env.RATE_KV.get(kvKey)) ?? '0', 10);
    if (current >= RATE_LIMIT) {
      return json({ error: 'Rate limit exceeded — try again later' }, 429);
    }
    const putOpts = current === 0 ? { expirationTtl: WINDOW_SECS } : {};
    await env.RATE_KV.put(kvKey, String(current + 1), putOpts);

    // ── Send via Resend ───────────────────────────────────────────────────────
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    env.FROM_EMAIL,
        to:      [to],
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error('[relay] Resend error:', resendRes.status, err);
      return json({ error: 'Upstream send failed' }, 502);
    }

    console.log('[relay] Sent to', to);
    return json({ ok: true });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
