// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { onlyJavaScript } from './opencvCache';

const reply = (body: string, status: number, type: string | null) =>
  new Response(body, { status, headers: type ? { 'content-type': type } : {} });

describe('onlyJavaScript (what the service worker may keep as the OpenCV chunk)', () => {
  it('keeps a JavaScript response', async () => {
    const js = reply('export default 1', 200, 'application/javascript; charset=utf-8');
    expect(await onlyJavaScript.cacheWillUpdate({ response: js })).toBe(js);
    const textJs = reply('export default 1', 200, 'text/javascript');
    expect(await onlyJavaScript.cacheWillUpdate({ response: textJs })).toBe(textJs);
  });

  it('refuses the app’s index.html served in place of a chunk that’s gone after a deploy', async () => {
    expect(await onlyJavaScript.cacheWillUpdate({ response: reply('<!doctype html>', 200, 'text/html') })).toBeNull();
  });

  it('refuses a failed response, even one labelled JavaScript', async () => {
    expect(await onlyJavaScript.cacheWillUpdate({ response: reply('', 404, 'application/javascript') })).toBeNull();
  });

  it('refuses a response with no content type', async () => {
    expect(await onlyJavaScript.cacheWillUpdate({ response: reply('x', 200, null) })).toBeNull();
  });
});
