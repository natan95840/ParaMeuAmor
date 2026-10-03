/* Service worker do diário.
   - Páginas (index.html): tenta a internet primeiro e, sem rede, usa a cópia guardada.
   - Sons, fotos, ícones e fontes: ficam guardados no aparelho depois do primeiro uso, e funcionam offline.
   Tudo com caminhos relativos, para funcionar em GitHub Pages (inclusive em subpasta /nome-do-repositorio/).
   Se um dia mudar a LISTA de arquivos abaixo, aumente a VERSAO para forçar a atualização. */
const VERSAO = 'v1';
const CORE = `diario-core-${VERSAO}`;
const MIDIA = `diario-midia-${VERSAO}`;
const FONTES = `diario-fontes-${VERSAO}`;
const ATUAIS = [CORE, MIDIA, FONTES];

const BASE = new URL('./', self.registration.scope).href;
const abs = p => new URL(p, BASE).href;

const ARQUIVOS_CORE = [
  './', './index.html', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png'
];
/* Guardados já na instalação para a música e os sons funcionarem offline desde a primeira vez.
   Se algum não existir, é ignorado sem atrapalhar a instalação. */
const ARQUIVOS_MIDIA = [
  './Sounds/agulhas_click.wav', './Sounds/book_close.wav', './Sounds/book_open.wav',
  './Sounds/carimbando_folha.wav', './Sounds/click_all_buttons.wav', './Sounds/error_sound.wav',
  './Sounds/page_turn.wav', './Sounds/som_timer_segundos.wav',
  './Sounds/Musica_Lisboa.ogg', './Sounds/Capa_Musica.jpg'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const core = await caches.open(CORE);
    const midia = await caches.open(MIDIA);
    await Promise.allSettled([
      ...ARQUIVOS_CORE.map(f => core.add(abs(f))),
      ...ARQUIVOS_MIDIA.map(f => midia.add(abs(f)))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n.startsWith('diario-') && !ATUAIS.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') { e.respondWith(paginaRedeFirst(req)); return; }

  if (url.origin === self.location.origin) {
    if (/\.(wav|ogg|oga|mp3|m4a|aac|opus)$/i.test(url.pathname)) { e.respondWith(audio(e)); return; }
    if (/\.(jpe?g|png|webp|gif|avif)$/i.test(url.pathname)) { e.respondWith(guardadoPrimeiro(req, MIDIA)); return; }
    e.respondWith(guardadoPrimeiro(req, CORE));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(guardadoPrimeiro(req, FONTES));
  }
});

/* páginas: internet primeiro (com 4 s de paciência); sem rede, a cópia guardada */
async function paginaRedeFirst(req) {
  const cache = await caches.open(CORE);
  const doCache = () => cache.match(req, { ignoreSearch: true }).then(r => r || cache.match(abs('./index.html')) || cache.match(abs('./')));
  try {
    const rede = await Promise.race([
      fetch(req),
      new Promise((_, no) => setTimeout(() => no(new Error('lento')), 4000))
    ]);
    if (rede && rede.ok) cache.put(abs('./index.html'), rede.clone());
    return rede;
  } catch (err) {
    const guardado = await doCache();
    if (guardado) return guardado;
    return fetch(req);
  }
}

/* arquivos estáticos: usa o que está guardado e atualiza por baixo dos panos */
async function guardadoPrimeiro(req, nome) {
  const cache = await caches.open(nome);
  const guardado = await cache.match(req);
  const atualiza = fetch(req).then(r => {
    if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
    return r;
  }).catch(() => null);
  if (guardado) return guardado;
  return (await atualiza) || Response.error();
}

/* áudio: navegadores pedem trechos (Range); respondemos do arquivo guardado */
async function audio(e) {
  const req = e.request, cache = await caches.open(MIDIA);
  const chave = req.url, guardado = await cache.match(chave);
  const faixa = req.headers.get('range');
  if (guardado) return faixa ? recorte(guardado, faixa) : guardado;
  if (!faixa) {
    try {
      const r = await fetch(chave);
      if (r.ok) cache.put(chave, r.clone());
      return r;
    } catch (err) { return Response.error(); }
  }
  e.waitUntil(cache.add(chave).catch(() => {}));     // guarda o arquivo inteiro para as próximas vezes
  return fetch(req);
}
async function recorte(resp, faixa) {
  const buf = await resp.arrayBuffer(), total = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(faixa);
  let ini = m && m[1] ? +m[1] : 0, fim = m && m[2] ? +m[2] : total - 1;
  if (m && !m[1] && m[2]) { ini = Math.max(0, total - +m[2]); fim = total - 1; }
  fim = Math.min(fim, total - 1);
  return new Response(buf.slice(ini, fim + 1), {
    status: 206, statusText: 'Partial Content',
    headers: {
      'Content-Type': resp.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${ini}-${fim}/${total}`,
      'Content-Length': String(fim - ini + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}
