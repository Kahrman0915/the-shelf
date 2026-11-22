import type { ReactNode } from 'react';
import type { PhotoSide } from '@/data/photos';

const ALT: Record<PhotoSide, string> = { front: 'Front photo', back: 'Back photo' };

/** One squared photo, 96 px, with its buttons below. */
export function PhotoThumb({
  side,
  url,
  squaring,
  noEdges,
  children,
}: {
  side: PhotoSide;
  url: string | null;
  squaring: boolean;
  noEdges: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-24 flex-col items-stretch gap-1">
      <div className="flex size-24 items-center justify-center overflow-hidden rounded-lg border-[1.5px] border-line-strong bg-surface-sunk">
        {squaring || !url ? (
          <span role="status" className="px-1 text-center text-[13px] text-ink-muted">
            {squaring ? 'Squaring up…' : ''}
          </span>
        ) : (
          <img src={url} alt={ALT[side]} className="size-full object-cover" />
        )}
      </div>
      {noEdges && !squaring && <p className="text-[13px] leading-4 text-ink-muted">Couldn’t find the edges</p>}
      {children}
    </div>
  );
}
