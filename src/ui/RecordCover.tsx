import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ShelfRecord } from '@/data/schema';
import { usePhotoUrl } from '@/data/usePhoto';
import { Poster } from './Poster';

function PosterFor({ record }: { record: ShelfRecord }) {
  return <Poster artist={record.artist} title={record.title} genre={record.genre} className="w-full" />;
}

function Photos({ record }: { record: ShelfRecord }) {
  const front = usePhotoUrl(record.coverPath);
  const back = usePhotoUrl(record.backPath);
  const [flipped, setFlipped] = useState(false);
  if (!front && !back) return <PosterFor record={record} />;
  const showBack = flipped && back !== null;
  const face = 'absolute inset-0 size-full [backface-visibility:hidden]';
  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-square w-full [perspective:1200px]">
        <div
          className="relative size-full [transform-style:preserve-3d] transition-transform duration-500 motion-reduce:transition-none"
          style={{ transform: showBack ? 'rotateY(180deg)' : undefined }}
        >
          {front ? (
            <img src={front} alt={`Front of ${record.title}`} aria-hidden={showBack ? true : undefined} className={`${face} object-cover`} />
          ) : (
            // No front photo (or not on the phone yet): the poster is the front, so a back photo can still be seen.
            <div aria-hidden={showBack ? true : undefined} className={face}>
              <PosterFor record={record} />
            </div>
          )}
          {back && (
            <img
              src={back}
              alt={`Back of ${record.title}`}
              aria-hidden={showBack ? undefined : true}
              className={`${face} [transform:rotateY(180deg)] object-cover`}
            />
          )}
        </div>
      </div>
      {back && (
        <div className="px-4">
          <Button
            variant="outline"
            className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent px-5 text-[15px] font-semibold"
            aria-label={showBack ? 'Show the front' : 'Show the back'}
            onClick={() => setFlipped((f) => !f)}
          >
            ↻ Flip
          </Button>
        </div>
      )}
    </div>
  );
}

/** The record's front photo (with Flip to the back), or its poster while there is no front photo on the phone.
 *  A back photo without a front still gets Flip, with the poster as the front. */
export function RecordCover({ record }: { record: ShelfRecord }) {
  if (!record.coverPath && !record.backPath) return <PosterFor record={record} />;
  return <Photos record={record} />;
}
