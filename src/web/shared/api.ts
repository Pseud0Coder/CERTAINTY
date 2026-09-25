/* API client. CSRF double-submit on mutations, SSE subscription for the
   event bus (A0: dashboards subscribe, agents never touch the UI). */

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)certainty_csrf=([^;]+)/);
  return m && m[1] ? decodeURIComponent(m[1]) : '';
}

async function request(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method === 'POST' ? { 'x-csrf': csrf() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `http_${res.status}`);
  return data;
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, body?: unknown) => request('POST', path, body ?? {}),
};

export function subscribe(topics: string[], onChange: () => void): void {
  const es = new EventSource('/api/events');
  es.onmessage = ev => {
    try {
      const frame = JSON.parse(ev.data) as { topic: string };
      if (topics.includes(frame.topic)) onChange();
    } catch { /* ignore malformed frames */ }
  };
  es.onerror = () => { /* the browser retries automatically */ };
}
