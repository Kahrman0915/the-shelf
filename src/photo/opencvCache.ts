// A Workbox plugin for the service worker's OpenCV cache (see vite.config.ts). It only lets a real
// JavaScript response in. After a deploy the old chunk's URL no longer exists, and the host answers
// it with the app's index.html (status 200); CacheFirst would otherwise keep that HTML as "OpenCV"
// and every later load would fail.
// Workbox copies this function into sw.js as text, so it must not use anything from outside itself.
export const onlyJavaScript = {
  cacheWillUpdate: async ({ response }: { response: Response }): Promise<Response | null> =>
    response.ok && (response.headers.get('content-type') ?? '').includes('javascript') ? response : null,
};
