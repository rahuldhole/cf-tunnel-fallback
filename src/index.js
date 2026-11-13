import minimalDarkHtml from '../themes/minimal-dark.html';
import terminalHtml from '../themes/terminal.html';
import statusDiagramHtml from '../themes/status-diagram.html';

const THEMES = {
  'minimal-dark': minimalDarkHtml,
  'terminal': terminalHtml,
  'status-diagram': statusDiagramHtml,
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

export function renderTemplate(template, data) {
  let html = template;
  for (const [key, val] of Object.entries(data)) {
    const re = new RegExp('{{' + key + '}}', 'g');
    html = html.replace(re, val);
  }
  return html;
}

export default {
  async fetch(request, env = {}, ctx) {
    const bypassToken = (env.BYPASS_TOKEN || '').trim();
    const url = new URL(request.url);

    // 0. Instant Preview Mode: Allows inspecting themes without taking down the tunnel
    // e.g. ?preview or ?preview=terminal or ?preview=status-diagram
    if (url.searchParams.has('preview')) {
      const requestedTheme = url.searchParams.get('preview')?.trim().toLowerCase();
      const previewThemeName = requestedTheme && THEMES[requestedTheme] ? requestedTheme : (env.THEME || 'minimal-dark').trim().toLowerCase();
      const previewTemplate = THEMES[previewThemeName] || THEMES['minimal-dark'];

      const retryAfter = env.RETRY_AFTER || '120';
      const siteName = env.SITE_NAME || 'My Service';
      const heading = env.HEADING || "We'll be right back";
      const message = env.MESSAGE || 'Our origin server is currently unreachable or undergoing scheduled maintenance.';
      const accentColor = sanitizeColor(env.ACCENT_COLOR);
      const autoRefresh = '0'; // Disable auto-refresh in preview mode
      const statusUrl = (env.STATUS_PAGE_URL || '').trim();

      let statusButtonHtml = '';
      if (statusUrl) {
        statusButtonHtml = '<a href="' + escapeHtml(statusUrl) + '" class="status-btn" target="_blank" rel="noopener noreferrer">Status Page</a>';
      }

      const rendered = renderTemplate(previewTemplate, {
        SITE_NAME: escapeHtml(siteName),
        HEADING: escapeHtml(heading),
        MESSAGE: escapeHtml(message),
        ACCENT_COLOR: accentColor,
        STATUS_CODE: '530',
        RETRY_AFTER: escapeHtml(retryAfter),
        STATUS_BUTTON: statusButtonHtml,
        AUTO_REFRESH_SECONDS: autoRefresh
      });

      return new Response(rendered, {
        status: 200,
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Tunnel-Fallback': 'preview'
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

    const interceptStatuses = (env.INTERCEPT_STATUSES || '502,504,530')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(Boolean);

    if (response && !interceptStatuses.includes(upstreamStatus)) {
      return response;
    }

    const retryAfter = env.RETRY_AFTER || '120';
    const siteName = env.SITE_NAME || 'My Service';
    const heading = env.HEADING || "We'll be right back";
    const message = env.MESSAGE || 'Our origin server is currently unreachable or undergoing scheduled maintenance.';
    const accentColor = sanitizeColor(env.ACCENT_COLOR);
    const autoRefresh = env.AUTO_REFRESH_SECONDS !== undefined ? String(env.AUTO_REFRESH_SECONDS) : '15';
    const statusUrl = (env.STATUS_PAGE_URL || '').trim();

    let statusButtonHtml = '';
    if (statusUrl) {
      statusButtonHtml = '<a href="' + escapeHtml(statusUrl) + '" class="status-btn" target="_blank" rel="noopener noreferrer">Status Page</a>';
    }

    const acceptHeader = request.headers.get('Accept') || '';
    const isJson = acceptHeader.includes('application/json') && !acceptHeader.includes('text/html');

    const commonHeaders = {
      'Status': '503',
      'Retry-After': retryAfter,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
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

    const selectedThemeName = (env.THEME || 'minimal-dark').trim().toLowerCase();
    const activeTemplate = THEMES[selectedThemeName] || THEMES['minimal-dark'];

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
