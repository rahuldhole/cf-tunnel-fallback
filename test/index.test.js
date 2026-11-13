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

  it('supports per-status code theme overrides (e.g. THEME_530, THEME_502)', async () => {
    globalThis.fetch = async () => new Response('Error', { status: 530 });
    const req = new Request('https://example.com/');
    const res = await worker.fetch(req, {
      THEME: 'minimal-dark',
      THEME_530: 'status-diagram'
    });
    const text = await res.text();
    assert.match(text, /Cloudflare/);
  });
