import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { markPhotoTipsSeen, usePhotoTipsSeen } from '@/data/photoDrafts';
import { PATH_FIELD, PHOTO_SIDES, type PhotoChanges, type PhotoSide } from '@/data/photos';
import type { ShelfRecord } from '@/data/schema';
import { useBytesUrl, usePhotoUrl } from '@/data/usePhoto';
import { squareUpPhoto, warmUpSquaring } from '@/photo/squareUp';
import { PhotoThumb } from './PhotoThumb';
import { PhotoTips } from './PhotoTips';
import { useCamera } from './useCamera';

const BTN = 'h-12 w-full rounded-lg text-[15px] font-semibold';
const LABEL: Record<PhotoSide, string> = { front: 'Front photo file', back: 'Back photo file' };
const GROUP: Record<PhotoSide, string> = { front: 'Front', back: 'Back' };

type SlotProps = {
  side: PhotoSide;
  record: ShelfRecord;
  changes: PhotoChanges;
  squaring: boolean;
  disabled: boolean;
  onTake: () => void;
  onRemove: () => void;
};

/** One side: the pending new photo, else the stored one, else an empty frame. */
function Slot({ side, record, changes, squaring, disabled, onTake, onRemove }: SlotProps) {
  const change = changes[side];
  const pending = change?.kind === 'new' ? change.photo : null;
  const stored = change ? null : record[PATH_FIELD[side]];
  const pendingUrl = useBytesUrl(pending?.bytes ?? null);
  const storedUrl = usePhotoUrl(stored);
  const hasPhoto = !!pending || !!stored;
  return (
    <div role="group" aria-label={GROUP[side]}>
      <PhotoThumb side={side} url={pending ? pendingUrl : storedUrl} squaring={squaring} noEdges={pending?.foundEdges === false}>
        <Button variant="ghost" className={BTN} disabled={disabled} onClick={onTake}>
          {hasPhoto ? 'Retake' : 'Take'}
        </Button>
        {hasPhoto && (
          <Button variant="ghost" className={BTN} onClick={onRemove}>
            Remove
          </Button>
        )}
      </PhotoThumb>
    </div>
  );
}

/** The Edit screen’s Photos section: take, retake or remove each side. Changes stay in the parent until Save. */
export function EditPhotos({
  record,
  changes,
  onChange,
}: {
  record: ShelfRecord;
  changes: PhotoChanges;
  onChange: (next: PhotoChanges) => void;
}) {
  const tipsSeen = usePhotoTipsSeen();
  // Which side asked for the tips, so Got it can open that side's camera; null when the tips were opened on their own.
  const [tipsFor, setTipsFor] = useState<PhotoSide | null>(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [squaring, setSquaring] = useState<Partial<Record<PhotoSide, boolean>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  // Squaring finishes later; it must build on the changes as they are then, not when the camera opened.
  const latest = useRef(changes);
  latest.current = changes;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Per side, bumped by each new photo, Remove and unmount, so a stale or late result is ignored.
  const taking = useRef<Record<PhotoSide, number>>({ front: 0, back: 0 });

  useEffect(() => {
    const counters = taking.current;
    return () => {
      counters.front++;
      counters.back++;
    };
  }, []);

  async function take(side: PhotoSide, file: File) {
    setFailure(null);
    const turn = ++taking.current[side];
    setSquaring((s) => ({ ...s, [side]: true }));
    try {
      const { bytes, foundEdges } = await squareUpPhoto(file);
      if (turn !== taking.current[side]) return;
      onChangeRef.current({ ...latest.current, [side]: { kind: 'new', photo: { side, bytes, foundEdges } } });
    } catch {
      if (turn === taking.current[side]) setFailure('Couldn’t prepare that photo. Try again.');
    } finally {
      if (turn === taking.current[side]) setSquaring((s) => ({ ...s, [side]: false }));
    }
  }

  const front = useCamera((f) => void take('front', f), LABEL.front);
  const back = useCamera((f) => void take('back', f), LABEL.back);
  const camera: Record<PhotoSide, { open(): void }> = { front, back };

  function start(side: PhotoSide) {
    if (!tipsSeen) {
      setTipsFor(side);
      setTipsOpen(true);
    } else camera[side].open();
    warmUpSquaring(); // after the camera's click, never before it
  }

  function tipsDismissed() {
    setTipsOpen(false);
    setTipsFor(null);
  }

  function tipsDone() {
    setTipsOpen(false);
    const side = tipsFor;
    setTipsFor(null);
    if (side) {
      void markPhotoTipsSeen();
      camera[side].open();
    }
  }

  function remove(side: PhotoSide) {
    taking.current[side]++;
    setSquaring((s) => ({ ...s, [side]: false }));
    const next = { ...latest.current };
    // A photo taken here and not yet saved just goes; a stored one is marked for removal.
    if (record[PATH_FIELD[side]]) next[side] = { kind: 'remove' };
    else delete next[side];
    onChange(next);
  }

  return (
    <section aria-labelledby="edit-photos" className="flex flex-col gap-3 px-4">
      {front.input}
      {back.input}
      <h2 id="edit-photos" className="text-[17px] font-semibold text-ink">
        Photos
      </h2>
      <div className="flex items-start gap-3">
        {PHOTO_SIDES.map((side) => (
          <Slot
            key={side}
            side={side}
            record={record}
            changes={changes}
            squaring={!!squaring[side]}
            disabled={tipsSeen === undefined}
            onTake={() => start(side)}
            onRemove={() => remove(side)}
          />
        ))}
      </div>
      {failure && (
        <p role="alert" className="text-[15px] text-brick-ink">
          {failure}
        </p>
      )}
      <Button
        variant="ghost"
        className={BTN}
        onClick={() => {
          setTipsFor(null);
          setTipsOpen(true);
        }}
      >
        Photo tips
      </Button>
      <PhotoTips open={tipsOpen} onDone={tipsDone} onDismiss={tipsDismissed} />
    </section>
  );
}
