const json = (body, status, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=UTF-8', ...headers } });

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  return origin && origin === env.ALLOWED_ORIGIN ? { 'access-control-allow-origin': origin, 'vary': 'Origin' } : {};
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
    if (request.method !== 'GET' || new URL(request.url).pathname !== '/search') return json({ message: 'Not found.' }, 404, cors);
    if (!cors['access-control-allow-origin']) return json({ message: '허용되지 않은 웹사이트 요청입니다.' }, 403);
    if (!env.GOOGLE_API_KEY || !env.GOOGLE_CSE_ID) return json({ message: '검색 서버 설정이 완료되지 않았습니다.' }, 503, cors);

    const q = (new URL(request.url).searchParams.get('q') || '').trim();
    if (!q || q.length > 160) return json({ message: '검색어는 1~160자로 입력하세요.' }, 400, cors);

    const googleUrl = new URL('https://www.googleapis.com/customsearch/v1');
    googleUrl.search = new URLSearchParams({ key: env.GOOGLE_API_KEY, cx: env.GOOGLE_CSE_ID, q, num: '10', safe: 'active' }).toString();
    try {
      const googleResponse = await fetch(googleUrl);
      const payload = await googleResponse.json();
      if (!googleResponse.ok) return json({ message: payload?.error?.message || 'Google 검색 요청에 실패했습니다.' }, googleResponse.status, cors);
      const items = (payload.items || []).map(item => ({ title: item.title || '', snippet: item.snippet || '', link: item.link || '', displayLink: item.displayLink || '' })).filter(item => item.link);
      return json({ items }, 200, { ...cors, 'cache-control': 'no-store' });
    } catch {
      return json({ message: '검색 서버가 Google에 연결하지 못했습니다.' }, 502, cors);
    }
  }
};
