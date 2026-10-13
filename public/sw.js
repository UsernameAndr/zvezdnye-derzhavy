// Нужен только для установки игры значком на экран. Ничего не кэширует: игра всегда берётся с сервера.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="background:#0b0e14;color:#ddd;font:16px sans-serif;padding:24px">Нет связи с сервером. Проверьте интернет и откройте игру ещё раз.</body>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
