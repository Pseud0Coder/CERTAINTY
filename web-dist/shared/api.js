/* API client. CSRF double-submit on mutations, SSE subscription for the
   event bus (A0: dashboards subscribe, agents never touch the UI). */
function csrf() {
    const m = document.cookie.match(/(?:^|;\s*)certainty_csrf=([^;]+)/);
    return m && m[1] ? decodeURIComponent(m[1]) : '';
}
async function request(method, path, body) {
    const res = await fetch(path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(method === 'POST' ? { 'x-csrf': csrf() } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(data?.error ?? `http_${res.status}`);
    return data;
}
export const api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body ?? {}),
};
export function subscribe(topics, onChange) {
    const es = new EventSource('/api/events');
    es.onmessage = ev => {
        try {
            const frame = JSON.parse(ev.data);
            if (topics.includes(frame.topic))
                onChange();
        }
        catch { /* ignore malformed frames */ }
    };
    es.onerror = () => { };
}
