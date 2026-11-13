# Cloudflare Tunnel Fallback Worker

A zero-dependency Cloudflare Worker designed to catch origin errors (such as HTTP 530 / Error 1033 when `cloudflared` is disconnected, or 502/504 when upstream services are down) and serve an inline, customizable fallback page.

---

## How It Works

When hosting applications via Cloudflare Tunnel, downtime typically surfaces as:
- **Error 1033 (HTTP 530)**: The origin tunnel (`cloudflared`) process or host machine is completely offline.
- **HTTP 502 / 504**: The tunnel connector is connected to Cloudflare Edge, but the target local service (Docker container, systemd daemon, local reverse proxy, or port) is unresponsive or timed out.

This Worker routes traffic ahead of or alongside your tunnel route:
1. It proxies incoming traffic to your upstream route.
2. If the response status is healthy (2xx, 3xx, or standard 4xx), it returns the response completely untouched.
3. If the upstream fails or returns an intercepted error (default `502, 504, 530`), it returns an HTTP `503 Service Unavailable` response with an inline fallback UI and `no-store` caching headers.
4. An inline auto-recovery script periodically checks for recovery via `HEAD` requests and seamlessly reloads the page once your origin service is restored.

---

## Deployment Options

### Method 1: Fork & Deploy to Cloudflare

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USERNAME/cf-tunnel-fallback)

1. Fork this repository or click the deploy button above.
2. Once deployed to Cloudflare Workers:
   - Navigate to **Workers & Pages** -> your worker -> **Settings** -> **Domains & Routes**.
   - Add a Route targeting your domain (e.g., `app.yourdomain.com/*`).
   - Ensure the Worker route is active for that hostname.
3. (Optional) Customize environment variables in **Settings** -> **Variables and Secrets**.

---

### Method 2: Manual CLI Deployment

1. Clone your repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/cf-tunnel-fallback.git
   cd cf-tunnel-fallback
   npm install
   ```

2. Review or update variables in `wrangler.toml`.

3. Deploy:
   ```bash
   npx wrangler deploy
   ```

4. Attach your custom domain or route either via `wrangler.toml` or the Cloudflare dashboard.

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

npx wrangler deploy
```

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