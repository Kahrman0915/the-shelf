import { useRef, type ReactNode } from 'react';

/**
 * A hidden camera input. iPhone only opens the camera from a tap, so call open() straight
 * from the tap handler, with nothing awaited before it.
 */
export function useCamera(onFile: (file: File) => void, label = 'Photo file'): { open(): void; input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture="environment"
      aria-label={label}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onFile(file);
      }}
    />
  );
  return { open: () => ref.current?.click(), input };
}
