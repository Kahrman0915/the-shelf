import type CvModule from '@techstark/opencv-js';

export type Cv = typeof CvModule;

type Runtime = Cv & { then?: unknown; onRuntimeInitialized?: () => void; onAbort?: (why: unknown) => void };

let loading: Promise<Cv> | null = null;

// Loads OpenCV.js (a ~10 MB chunk) on first use and resolves once its WebAssembly runtime is ready.
// The package's default export is the Emscripten Module object, whose `then(f)` calls `f(Module)`:
// awaiting it, or resolving a promise with it, adopts that `then` again and again forever. So it's
// never awaited or returned from a `.then`; once the runtime is up its `then` is deleted and it's
// an ordinary object. It's imported through ./opencv for the same reason (see there).
export function loadCv(): Promise<Cv> {
  loading ??= import('./opencv')
    .then(
      ({ default: mod }) =>
        new Promise<Cv>((resolve, reject) => {
          const runtime = mod as Runtime;
          const ready = () => {
            delete runtime.then;
            resolve(runtime);
          };
          runtime.onRuntimeInitialized = ready;
          runtime.onAbort = (why) => reject(new Error(`OpenCV failed to start: ${String(why)}`));
          if ('Mat' in runtime) ready(); // already up (the other export style)
        }),
    )
    .catch((err: unknown) => {
      loading = null; // let the next photo try again (say the first try had no signal)
      throw err;
    });
  return loading;
}
