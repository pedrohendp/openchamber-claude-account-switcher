// Serves dev/preview.html (a simulated OpenChamber host with fake accounts)
// next to the built panel, so the UI can be tried without installing it.
// Run `bun run build` first; the preview loads panel/main.js as shipped.

const root = new URL('../', import.meta.url);
const port = Number(process.env.PORT ?? 4517);

const files: Record<string, { path: string; type: string }> = {
  '/': { path: 'dev/preview.html', type: 'text/html; charset=utf-8' },
  '/panel/index.html': { path: 'panel/index.html', type: 'text/html; charset=utf-8' },
  '/panel/main.js': { path: 'panel/main.js', type: 'text/javascript; charset=utf-8' },
};

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch(request) {
    const file = files[new URL(request.url).pathname];
    if (!file) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(new URL(file.path, root)), {
      headers: { 'content-type': file.type, 'cache-control': 'no-store' },
    });
  },
});

console.log(`Preview: http://${server.hostname}:${server.port}/`);
