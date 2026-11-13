import defaultHtml from './fallback.html';
import minimalDarkHtml from '../themes/minimal-dark.html';
import terminalHtml from '../themes/terminal.html';
import statusDiagramHtml from '../themes/status-diagram.html';
import customSampleHtml from '../themes/custom-sample.html';

const THEMES = {
  'default': defaultHtml,
  'fallback': defaultHtml,
  'minimal-dark': minimalDarkHtml,
  'terminal': terminalHtml,
  'status-diagram': statusDiagramHtml,
  'custom-sample': customSampleHtml,
};

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeColor(color) {
  if (!color || typeof color !== 'string') return '#f59e0b';
  const trimmed = color.trim();
  const hexRegex = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/;
  const rgbRegex = /^rgba?\([\d\s.,%]+\)$/;
  const hslRegex = /^hsla?\([\d\s.,%]+\)$/;
  if (hexRegex.test(trimmed) || rgbRegex.test(trimmed) || hslRegex.test(trimmed)) {
    return trimmed;
  }
  return '#f59e0b';
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return trimmed;
    }
  } catch (_) {}
  return '';
}

export function renderTemplate(template, data) {
  let html = template;
  for (const [key, val] of Object.entries(data)) {
    const re = new RegExp('{{' + key + '}}', 'g');
    html = html.replace(re, val);
  }
  return html;
}

export function shouldInterceptStatus(interceptConfig, status) {
  if (!interceptConfig || typeof interceptConfig !== 'string') return false;
  const rules = interceptConfig.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);

  for (const rule of rules) {
    if (rule === '*' || rule === 'all') {
      if (status >= 400) return true;
    } else if (/^[1-5](xx|\*\*|\*)$/.test(rule)) {
      const family = parseInt(rule[0], 10);
      if (Math.floor(status / 100) === family) return true;
    } else {
      const code = parseInt(rule, 10);
      if (!isNaN(code) && code === status) return true;
    }
  }
  return false;
}

export function resolveStatusEnvVar(env, prefix, status) {
  if (!status) return undefined;
  // 1. Exact match e.g. THEME_530 or CUSTOM_HTML_530
  if (env[`${prefix}_${status}`]) return env[`${prefix}_${status}`];

  // 2. Class match e.g. THEME_5XX, THEME_5**, THEME_5*
  const family = Math.floor(status / 100);
  const patterns = [`${prefix}_${family}XX`, `${prefix}_${family}xx`, `${prefix}_${family}**`, `${prefix}_${family}*`];
  for (const p of patterns) {
    if (env[p]) return env[p];
  }

  // 3. Catch-all match e.g. THEME_* or THEME_ALL
  if (status >= 400) {
    const catchAlls = [`${prefix}_*`, `${prefix}_ALL`, `${prefix}_all`];
    for (const ca of catchAlls) {
      if (env[ca]) return env[ca];
    }
  }

  return undefined;
}

export default {
  async fetch(request, env = {}, ctx) {
    const bypassToken = (env.BYPASS_TOKEN || '').trim();
    const url = new URL(request.url);

    // 0. Instant Preview Mode: Allows inspecting themes without taking down the tunnel
    // e.g. ?preview or ?preview=terminal or ?preview_error=502 or ?preview=terminal&preview_error=504
    if (url.searchParams.has('preview') || url.searchParams.has('preview_error')) {
      const previewErrorParam = url.searchParams.get('preview_error');
      const simulatedStatusCode = previewErrorParam && !isNaN(parseInt(previewErrorParam, 10))
        ? parseInt(previewErrorParam, 10)
        : 530;

      const retryAfter = env.RETRY_AFTER || '120';
      const siteName = env.SITE_NAME || 'My Service';
      const heading = env.HEADING || "We'll be right back";
      const message = env.MESSAGE || 'Our origin server is currently unreachable or undergoing scheduled maintenance.';
      const accentColor = sanitizeColor(env.ACCENT_COLOR);
      const autoRefresh = '0'; // Disable auto-refresh in preview mode
      const statusUrl = sanitizeUrl(env.STATUS_PAGE_URL);

      const acceptHeader = request.headers.get('Accept') || '';
      const contentTypeHeader = request.headers.get('Content-Type') || '';
      const isApiRoute = url.pathname.startsWith('/api/') || url.pathname.endsWith('.json');
      const isJson = (
        (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) ||
        contentTypeHeader.includes('application/json') ||
        isApiRoute
      );

      const previewHeaders = {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Robots-Tag': 'noindex, nofollow, noarchive',
        'X-Tunnel-Fallback': 'preview',
        'Retry-After': retryAfter
      };

      if (request.method === 'HEAD') {
        const contentType = isJson ? 'application/json;charset=UTF-8' : 'text/html;charset=UTF-8';
        return new Response(null, {
          status: 200,
          headers: {
            ...previewHeaders,
            'Content-Type': contentType
          }
        });
      }

      if (isJson) {
        const jsonBody = JSON.stringify({
          error: 'Service Unavailable',
          message: message,
          upstream_status: simulatedStatusCode,
          retry_after: parseInt(retryAfter, 10) || 120
        });
        return new Response(jsonBody, {
          status: 200,
          headers: {
            ...previewHeaders,
            'Content-Type': 'application/json;charset=UTF-8'
          }
        });
      }

      const requestedTheme = url.searchParams.get('preview')?.trim().toLowerCase();
      const statusCustomHtml = resolveStatusEnvVar(env, 'CUSTOM_HTML', simulatedStatusCode);
      const statusThemeOverride = resolveStatusEnvVar(env, 'THEME', simulatedStatusCode);

      let previewThemeName;
      if (requestedTheme && THEMES[requestedTheme]) {
        previewThemeName = requestedTheme;
      } else if (statusThemeOverride && THEMES[statusThemeOverride.trim().toLowerCase()]) {
        previewThemeName = statusThemeOverride.trim().toLowerCase();
      } else {
        previewThemeName = (env.THEME || 'minimal-dark').trim().toLowerCase();
      }

      const previewTemplate = statusCustomHtml || env.CUSTOM_HTML || THEMES[previewThemeName] || THEMES['minimal-dark'];

      let statusButtonHtml = '';
      if (statusUrl) {
        statusButtonHtml = '<a href="' + escapeHtml(statusUrl) + '" class="status-btn" target="_blank" rel="noopener noreferrer">Status Page</a>';
      }

      const rendered = renderTemplate(previewTemplate, {
        SITE_NAME: escapeHtml(siteName),
        HEADING: escapeHtml(heading),
        MESSAGE: escapeHtml(message),
        ACCENT_COLOR: accentColor,
        STATUS_CODE: String(simulatedStatusCode),
        RETRY_AFTER: escapeHtml(retryAfter),
        STATUS_BUTTON: statusButtonHtml,
        AUTO_REFRESH_SECONDS: autoRefresh
      });

      return new Response(rendered, {
        status: 200,
        headers: {
          ...previewHeaders,
          'Content-Type': 'text/html;charset=UTF-8'
        }
      });
    }

    let isBypass = false;
    if (bypassToken) {
      const headerToken = request.headers.get('X-Bypass-Token');
      const queryToken = url.searchParams.get('bypass');
      if (headerToken === bypassToken || queryToken === bypassToken) {
        isBypass = true;
      }
    }

    if (isBypass) {
      if (url.searchParams.has('bypass')) {
        url.searchParams.delete('bypass');
        request = new Request(url.toString(), request);
      }
      return fetch(request);
    }

    let response;
    let upstreamStatus = 0;
    try {
      response = await fetch(request);
      upstreamStatus = response.status;
    } catch (err) {
      upstreamStatus = 530;
    }

    const interceptConfig = env.INTERCEPT_STATUSES !== undefined ? String(env.INTERCEPT_STATUSES) : '502,504,530';
    if (response && !shouldInterceptStatus(interceptConfig, upstreamStatus)) {
      return response;
    }

    const retryAfter = env.RETRY_AFTER || '120';
    const siteName = env.SITE_NAME || 'My Service';
    const heading = env.HEADING || "We'll be right back";
    const message = env.MESSAGE || 'Our origin server is currently unreachable or undergoing scheduled maintenance.';
    const accentColor = sanitizeColor(env.ACCENT_COLOR);
    const autoRefresh = env.AUTO_REFRESH_SECONDS !== undefined ? String(env.AUTO_REFRESH_SECONDS) : '15';
    const statusUrl = sanitizeUrl(env.STATUS_PAGE_URL);

    let statusButtonHtml = '';
    if (statusUrl) {
      statusButtonHtml = '<a href="' + escapeHtml(statusUrl) + '" class="status-btn" target="_blank" rel="noopener noreferrer">Status Page</a>';
    }

    const acceptHeader = request.headers.get('Accept') || '';
    const contentTypeHeader = request.headers.get('Content-Type') || '';
    const isApiRoute = url.pathname.startsWith('/api/') || url.pathname.endsWith('.json');
    const isJson = (
      (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) ||
      contentTypeHeader.includes('application/json') ||
      isApiRoute
    );

    const commonHeaders = {
      'Status': '503',
      'Retry-After': retryAfter,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Tunnel-Fallback': 'active'
    };

    if (request.method === 'HEAD') {
      const contentType = isJson ? 'application/json;charset=UTF-8' : 'text/html;charset=UTF-8';
      return new Response(null, {
        status: 503,
        headers: {
          ...commonHeaders,
          'Content-Type': contentType
        }
      });
    }

    if (isJson) {
      const jsonBody = JSON.stringify({
        error: 'Service Unavailable',
        message: message,
        upstream_status: upstreamStatus,
        retry_after: parseInt(retryAfter, 10) || 120
      });
      return new Response(jsonBody, {
        status: 503,
        headers: {
          ...commonHeaders,
          'Content-Type': 'application/json;charset=UTF-8'
        }
      });
    }

    // Theme Selection Priority:
    // 1. Direct custom raw HTML env var per-status (e.g. CUSTOM_HTML_530, CUSTOM_HTML_5XX, CUSTOM_HTML_*)
    // 2. Direct global custom raw HTML env var: CUSTOM_HTML
    // 3. Named theme per-status override (e.g. THEME_530, THEME_5XX, THEME_*)
    // 4. Global named theme: THEME
    // 5. Default fallback theme: "minimal-dark"
    const customStatusHtml = resolveStatusEnvVar(env, 'CUSTOM_HTML', upstreamStatus);
    const statusThemeOverride = resolveStatusEnvVar(env, 'THEME', upstreamStatus);
    const selectedThemeName = (statusThemeOverride || env.THEME || 'minimal-dark').trim().toLowerCase();
    const activeTemplate = customStatusHtml || env.CUSTOM_HTML || THEMES[selectedThemeName] || THEMES['minimal-dark'];

    const rendered = renderTemplate(activeTemplate, {
      SITE_NAME: escapeHtml(siteName),
      HEADING: escapeHtml(heading),
      MESSAGE: escapeHtml(message),
      ACCENT_COLOR: accentColor,
      STATUS_CODE: String(upstreamStatus || 530),
      RETRY_AFTER: escapeHtml(retryAfter),
      STATUS_BUTTON: statusButtonHtml,
      AUTO_REFRESH_SECONDS: escapeHtml(autoRefresh)
    });

    return new Response(rendered, {
      status: 503,
      headers: {
        ...commonHeaders,
        'Content-Type': 'text/html;charset=UTF-8'
      }
    });
  }
};
