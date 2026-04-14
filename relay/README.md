# DESeq2 ExploreR — Notification Relay

A Cloudflare Worker that receives `POST /send` requests from the Docker container
and forwards them to [Resend](https://resend.com) for delivery.

**SMTP credentials never leave Cloudflare** — they are stored as encrypted Worker
secrets. End users pull the pre-built Docker image and email notifications work
with zero configuration.

---

## One-time setup (~10 minutes)

### 1. Prerequisites

```bash
# Node ≥ 18 required
npm install          # installs wrangler locally
npx wrangler login   # opens browser → authorise with your Cloudflare account
```

You also need a free [Resend](https://resend.com) account and a verified sending domain.
Resend requires domain ownership for custom from-addresses; a cheap domain works fine.

### 2. Create the KV namespace

```bash
npx wrangler kv:namespace create RATE_KV
```

Copy the printed `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RATE_KV"
id      = "PASTE_ID_HERE"
```

### 3. Generate a relay token

```bash
openssl rand -hex 32
# example: a3f8c2d1e4b5…
```

Keep this value — you'll need it in steps 4 and 5.

### 4. Set Worker secrets

```bash
npx wrangler secret put RESEND_API_KEY   # paste your Resend API key
npx wrangler secret put FROM_EMAIL       # e.g. DESeq2 ExploreR <noreply@yourdomain.com>
npx wrangler secret put NOTIFY_TOKEN     # paste the token from step 3
```

### 5. Deploy

```bash
npx wrangler deploy
# → https://deseq2-notify.<your-subdomain>.workers.dev
```

### 6. Add secrets to GitHub

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name    | Value                                                      |
|----------------|------------------------------------------------------------|
| `NOTIFY_URL`   | `https://deseq2-notify.<your-subdomain>.workers.dev/send`  |
| `NOTIFY_TOKEN` | the token from step 3                                      |

Push to `main` — GitHub Actions rebuilds the image with these baked in.
After that, every user who pulls the image gets working email notifications
with no `.env` setup required.

---

## Verify it works

```bash
curl -X POST https://deseq2-notify.<your-subdomain>.workers.dev/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"you@example.com","subject":"Test","html":"<p>It works!</p>"}'
# → {"ok":true}
```

---

## Rate limiting

The Worker enforces **3 emails per recipient per 6 hours** via Cloudflare KV.
Adjust `RATE_LIMIT` and `WINDOW_SECS` at the top of `worker.js` if needed,
then redeploy with `npx wrangler deploy`.

---

## Rotating the relay token

1. Generate a new token: `openssl rand -hex 32`
2. `npx wrangler secret put NOTIFY_TOKEN` → paste new value
3. Update `NOTIFY_TOKEN` in GitHub secrets
4. Push any change to `main` to trigger a rebuild
