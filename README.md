# Cloudflare Tunnel Fallback Worker

A zero-dependency Cloudflare Worker designed to catch origin errors (such as HTTP 530 / Error 1033 when `cloudflared` is disconnected, or 502/504 when upstream services are down) and serve an inline, customizable fallback page.

---

## How It Works (The Core Concept)

> [!IMPORTANT]
> **This Worker binds to the EXACT SAME domain as your Cloudflare Tunnel.**
> You do **not** need a separate subdomain or redirect. Both your Tunnel and this Worker share the exact same hostname (e.g. `example.com/*` or `app.example.com/*`).

```text
Visitor hits: https://app.yourdomain.com
                    │
                    ▼
          [ Cloudflare Edge ]
                    │
                    ▼
         [ cf-tunnel-fallback ]  <── Worker assigned to: app.yourdomain.com/*
                    │
                    ▼
          Worker fetches upstream
                    │
                    ▼
       [ Cloudflare Tunnel connector ]
                    │
       ┌────────────┴────────────┐
       ▼                         ▼
Origin Healthy (200 OK)    Origin Down (530 / 502 / 504)
Worker passes traffic       Worker intercepts & serves
untouched to visitor        custom inline fallback UI
```

### Why downtime happens:
- **Error 1033 (HTTP 530)**: Origin `cloudflared` tunnel process or host server is completely offline.
- **HTTP 502 / 504**: The tunnel daemon is online, but your local Docker container, reverse proxy, or backend port is unresponsive or timed out.

### Why visiting the `.workers.dev` URL looks blank / 404:
When deployed, Cloudflare gives you a default testing URL like `https://cf-tunnel-fallback.<user>.workers.dev`. If you open that URL directly, you will see Cloudflare's generic **404 Page not found**! 

**Why?** Because the Worker is a reverse-proxy that forwards requests upstream: `.workers.dev` has no origin server attached to it, so Cloudflare Edge returns a 404. Since 404 is not an intercepted server crash status, the worker lets it pass through. 

**To activate the fallback page**, simply bind the Worker route to your real domain (instructions below).

---

## Deployment & Setup

### Method 1: Fork & Deploy to Cloudflare

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rahuldhole/cf-tunnel-fallback)

1. Click the **Deploy to Cloudflare** button above (or fork this repo).
2. Follow Cloudflare's prompts to authorize and deploy.

### Critical Step: Attach the Worker to Your Tunnel Domain
Once deployed, you **must** assign the Worker to the same route as your tunnel:
1. In Cloudflare Dashboard, go to **Workers & Pages** -> **`cf-tunnel-fallback`** -> **Settings** -> **Domains & Routes**.
2. Under **Routes**, click **Add Route**:
   - **Route**: `app.yourdomain.com/*` (or `yourdomain.com/*` or wildcard `*.yourdomain.com/*`)
   - **Zone**: Select your domain zone (`yourdomain.com`)
3. Click **Save**.

That's it! When your tunnel is live, your app loads normally. When your tunnel or container is down, your branded fallback page renders seamlessly on that exact URL.

---

### Method 2: Manual CLI Deployment

1. Clone the repository:
   ```bash
   git clone https://github.com/rahuldhole/cf-tunnel-fallback.git
   cd cf-tunnel-fallback
   npm install
   ```

2. Configure environment variables in `wrangler.toml` under `[vars]`.

3. Deploy:
   ```bash
   npx wrangler deploy
   ```

4. Attach your custom domain route in the Cloudflare dashboard as described in the step above.

---

## Configuration Reference

Variables can be defined in `wrangler.toml` under `[vars]` or in the Cloudflare Dashboard under **Worker Settings -> Variables**:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `THEME` | `"minimal-dark"` | Active theme: `"minimal-dark"`, `"terminal"`, or `"status-diagram"`. |
| `SITE_NAME` | `"My Service"` | Brand or application name displayed in the header. |
| `HEADING` | `"We'll be right back"` | Primary title shown on the fallback page. |
| `MESSAGE` | `"Our origin server is currently unreachable..."` | Description explaining the temporary outage. |
| `ACCENT_COLOR` | `"#f59e0b"` | Hex/RGB accent color used for indicators and buttons. |
| `INTERCEPT_STATUSES` | `"502,504,530"` | Comma-delimited list of upstream HTTP statuses to catch. |
| `RETRY_AFTER` | `"120"` | Seconds sent in the `Retry-After` HTTP header. |
| `STATUS_PAGE_URL` | `""` | Optional URL to an external status monitor (displays a button if populated). |
| `BYPASS_TOKEN` | `""` | Secret string allowing owners to bypass fallback via `?bypass=<token>` or `X-Bypass-Token`. |
| `AUTO_REFRESH_SECONDS` | `"15"` | Polling interval in seconds for automatic client reload (`0` disables). |

---

## Switching Built-in Themes

You can switch themes directly without editing files or redeploying code.

Set the `THEME` environment variable in `wrangler.toml` (or Cloudflare Dashboard -> **Worker Settings -> Variables**):
- `minimal-dark` (Default): Sleek zinc/slate dark UI with pulsing status indicator.
- `terminal`: Diagnostic screen mimicking an SSH/CLI probe.
- `status-diagram`: 3-node visual architecture diagram (`Browser` → `Cloudflare Edge` → `Origin Host`).

```toml
[vars]
THEME = "terminal"
```

---

## Instant Preview Mode

You can preview the fallback screen at any time on your live domain or `.workers.dev` URL without taking down your server or tunnel:

- **Preview current active theme**:
  `https://yourdomain.com/?preview`
- **Preview a specific theme**:
  - `https://yourdomain.com/?preview=minimal-dark`
  - `https://yourdomain.com/?preview=terminal`
  - `https://yourdomain.com/?preview=status-diagram`

*(In preview mode, client-side auto-reload is paused and returns HTTP 200 with `X-Tunnel-Fallback: preview`).*

> [!NOTE]
> **SEO & Crawler Safety**: All preview and fallback responses automatically include `X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: no-store`. Search engine crawlers (Googlebot, Bingbot) will never index, crawl, or cache your fallback or preview screens over your real application.

---

## Quota Optimization Tip

To prevent consuming your free daily Worker quota (100,000 requests/day) on static assets, add bypass routes in the Cloudflare dashboard:
1. Navigate to your zone -> **Workers Routes**.
2. Add routes such as `app.yourdomain.com/assets/*` or `app.yourdomain.com/*.js` with Worker set to **None**.

---

## Testing & Verification

Simulate upstream errors or test content negotiation:

- **HTML response check:**
  ```bash
  curl -i -H "Accept: text/html" https://yourdomain.com
  ```
- **API / JSON response check:**
  ```bash
  curl -i -H "Accept: application/json" https://yourdomain.com
  ```
- **Bypass token verification:**
  ```bash
  curl -i -H "X-Bypass-Token: your_secret_token" https://yourdomain.com
  ```
- **Preview mode test:**
  ```bash
  curl -i https://yourdomain.com/?preview
  ```