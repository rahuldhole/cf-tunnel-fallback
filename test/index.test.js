import { describe, it } from 'node:test';
import assert from 'node:assert';
import worker, { renderTemplate } from '../src/index.js';

describe('cf-tunnel-fallback worker tests', () => {
  const dummyHtml = '<html><body><h1>{{HEADING}}</h1><p>{{MESSAGE}}</p><span>{{STATUS_CODE}}</span></body></html>';

  it('passes through 200 OK without modification', async () => {
    globalThis.fetch = async () => new Response('All good', { status: 200, headers: { 'Content-Type': 'text/plain' } });

    const req = new Request('https://example.com/');
    const res = await worker.fetch(req, {});
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.strictEqual(text, 'All good');
  });

  it('intercepts 530, 502, and 504 and returns 503', async () => {
    for (const code of [502, 504, 530]) {
      globalThis.fetch = async () => new Response('Error', { status: code });
      const req = new Request('https://example.com/', { headers: { 'Accept': 'text/html' } });
      const res = await worker.fetch(req, {});
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.headers.get('X-Tunnel-Fallback'), 'active');
      assert.strictEqual(res.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate');
      assert.strictEqual(res.headers.get('Retry-After'), '120');
      const text = await res.text();
      assert.match(text, new RegExp(String(code)));
    }
  });

  it('passes through 404 and 500 by default', async () => {
    for (const code of [404, 500]) {
      globalThis.fetch = async () => new Response('Normal Error', { status: code });
      const req = new Request('https://example.com/');
      const res = await worker.fetch(req, {});
      assert.strictEqual(res.status, code);
      assert.strictEqual(res.headers.get('X-Tunnel-Fallback'), null);
    }
  });

  it('returns structured JSON for application/json requests', async () => {
    globalThis.fetch = async () => new Response('Error', { status: 502 });
    const req = new Request('https://example.com/api/test', {
      headers: { 'Accept': 'application/json' }
    });
    const res = await worker.fetch(req, {});
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.headers.get('Content-Type'), 'application/json;charset=UTF-8');
    const data = await res.json();
    assert.strictEqual(data.error, 'Service Unavailable');
    assert.strictEqual(data.upstream_status, 502);
    assert.strictEqual(data.retry_after, 120);
  });

  it('handles HEAD requests properly with 503 and null body', async () => {
    globalThis.fetch = async () => new Response('Error', { status: 530 });
    const req = new Request('https://example.com/', { method: 'HEAD' });
    const res = await worker.fetch(req, {});
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.headers.get('X-Tunnel-Fallback'), 'active');
    const text = await res.text();
    assert.strictEqual(text, '');
  });

  it('bypasses fallback when bypass token is provided', async () => {
    globalThis.fetch = async (r) => {
      const u = new URL(r.url);
      assert.strictEqual(u.searchParams.has('bypass'), false);
      return new Response('Raw Upstream 530', { status: 530 });
    };

    const env = { BYPASS_TOKEN: 'secret123' };
    const reqWithQuery = new Request('https://example.com/test?bypass=secret123');
    const res1 = await worker.fetch(reqWithQuery, env);
    assert.strictEqual(res1.status, 530);
    assert.strictEqual(res1.headers.get('X-Tunnel-Fallback'), null);

    const reqWithHeader = new Request('https://example.com/test', {
      headers: { 'X-Bypass-Token': 'secret123' }
    });
    const res2 = await worker.fetch(reqWithHeader, env);
    assert.strictEqual(res2.status, 530);
    assert.strictEqual(res2.headers.get('X-Tunnel-Fallback'), null);
  });

  it('escapes HTML special characters in env variables', async () => {
    globalThis.fetch = async () => { throw new Error('Network failed'); };
    const env = {
      HEADING: '<script>alert("xss")</script>',
      MESSAGE: 'Fish & Chips < "fun"'
    };
    const req = new Request('https://example.com/');
    const res = await worker.fetch(req, env);
    const html = await res.text();
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert/);
    assert.match(html, /Fish &amp; Chips &lt; &quot;fun&quot;/);
  });
});

  it('selects theme based on THEME env var', async () => {
    globalThis.fetch = async () => new Response('Error', { status: 530 });

    const reqTerminal = new Request('https://example.com/');
    const resTerminal = await worker.fetch(reqTerminal, { THEME: 'terminal' });
    const textTerminal = await resTerminal.text();
    assert.match(textTerminal, /DIAGNOSTIC TERMINAL/);

    const reqDiagram = new Request('https://example.com/');
    const resDiagram = await worker.fetch(reqDiagram, { THEME: 'status-diagram' });
    const textDiagram = await resDiagram.text();
    assert.match(textDiagram, /Cloudflare/);
  });

  it('renders preview mode with ?preview or ?preview=<theme>', async () => {
    const reqDefault = new Request('https://example.com/?preview');
    const resDefault = await worker.fetch(reqDefault, { SITE_NAME: 'Preview Site' });
    assert.strictEqual(resDefault.status, 200);
    assert.strictEqual(resDefault.headers.get('X-Tunnel-Fallback'), 'preview');
    const textDefault = await resDefault.text();
    assert.match(textDefault, /Preview Site/);

    const reqTerminal = new Request('https://example.com/?preview=terminal');
    const resTerminal = await worker.fetch(reqTerminal, {});
    assert.strictEqual(resTerminal.status, 200);
    const textTerminal = await resTerminal.text();
    assert.match(textTerminal, /DIAGNOSTIC TERMINAL/);

    const reqDiagram = new Request('https://example.com/?preview=status-diagram');
    const resDiagram = await worker.fetch(reqDiagram, {});
    assert.strictEqual(resDiagram.status, 200);
    const textDiagram = await resDiagram.text();
    assert.match(textDiagram, /Cloudflare/);
  });

  it('detects API routes by path or Content-Type header and returns JSON', async () => {
    globalThis.fetch = async () => new Response('Error', { status: 502 });

    // Path check /api/...
    const reqApiPath = new Request('https://example.com/api/v1/users');
    const res1 = await worker.fetch(reqApiPath, {});
    assert.strictEqual(res1.status, 503);
    assert.strictEqual(res1.headers.get('Content-Type'), 'application/json;charset=UTF-8');
    const body1 = await res1.json();
    assert.strictEqual(body1.error, 'Service Unavailable');

    // Content-Type check
    const reqContentType = new Request('https://example.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const res2 = await worker.fetch(reqContentType, {});
    assert.strictEqual(res2.status, 503);
    assert.strictEqual(res2.headers.get('Content-Type'), 'application/json;charset=UTF-8');
  });

  it('supports per-status code theme overrides (e.g. THEME_530, THEME_502, THEME_504)', async () => {
    // 1. Check 530 overriding to status-diagram
    globalThis.fetch = async () => new Response('Error', { status: 530 });
    const req1 = new Request('https://example.com/');
    const res1 = await worker.fetch(req1, {
      THEME: 'minimal-dark',
      THEME_530: 'status-diagram'
    });
    const text1 = await res1.text();
    assert.match(text1, /Cloudflare/);

    // 2. Check 502 overriding to terminal
    globalThis.fetch = async () => new Response('Error', { status: 502 });
    const req2 = new Request('https://example.com/');
    const res2 = await worker.fetch(req2, {
      THEME: 'minimal-dark',
      THEME_502: 'terminal'
    });
    const text2 = await res2.text();
    assert.match(text2, /DIAGNOSTIC TERMINAL/);

    // 3. Check 504 overriding to default/fallback theme
    globalThis.fetch = async () => new Response('Error', { status: 504 });
    const req3 = new Request('https://example.com/');
    const res3 = await worker.fetch(req3, {
      THEME: 'terminal',
      THEME_504: 'default'
    });
    const text3 = await res3.text();
    assert.doesNotMatch(text3, /DIAGNOSTIC TERMINAL/);
    assert.match(text3, /Error 504/);
  });

  it('allows injecting custom raw HTML via CUSTOM_HTML and CUSTOM_HTML_<status>', async () => {
    globalThis.fetch = async () => new Response('Error', { status: 502 });

    // Global custom HTML
    const req1 = new Request('https://example.com/');
    const res1 = await worker.fetch(req1, {
      CUSTOM_HTML: '<div id="custom-global">Custom Outage {{STATUS_CODE}}</div>'
    });
    const text1 = await res1.text();
    assert.match(text1, /<div id="custom-global">Custom Outage 502<\/div>/);

    // Per-status custom HTML override
    globalThis.fetch = async () => new Response('Error', { status: 530 });
    const req2 = new Request('https://example.com/');
    const res2 = await worker.fetch(req2, {
      CUSTOM_HTML: '<div>Global</div>',
      CUSTOM_HTML_530: '<div id="custom-530">Custom Tunnel Crash!</div>'
    });
    const text2 = await res2.text();
    assert.match(text2, /<div id="custom-530">Custom Tunnel Crash!<\/div>/);
  });

  it('renders custom theme files added to themes/ (e.g. themes/custom-sample.html)', async () => {
    globalThis.fetch = async () => new Response('Error', { status: 504 });

    const req = new Request('https://example.com/');
    const res = await worker.fetch(req, {
      THEME: 'minimal-dark',
      THEME_504: 'custom-sample',
      HEADING: 'Custom Outage Heading',
      MESSAGE: 'Custom message in custom theme'
    });
    assert.strictEqual(res.status, 503);
    const text = await res.text();
    assert.match(text, /id="custom-theme-test"/);
    assert.match(text, /Custom Outage Heading/);
    assert.match(text, /Custom message in custom theme/);
    assert.match(text, /Status: 504/);
  });
