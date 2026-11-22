import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { dropDraft, markPhotoTipsSeen, saveDraft, useDrafts, usePhotoTipsSeen } from '@/data/photoDrafts';
import { PHOTO_SIDES, type DraftPhoto, type PhotoSide } from '@/data/photos';
import { useBytesUrl } from '@/data/usePhoto';
import { squareUpPhoto, warmUpSquaring } from '@/photo/squareUp';
import { PhotoThumb } from './PhotoThumb';
import { PhotoTips } from './PhotoTips';
import { useCamera } from './useCamera';

const BIG = 'h-14 w-full rounded-lg font-display text-[22px] tracking-[0.04em]';
const SMALL = 'h-12 w-full rounded-lg text-[15px] font-semibold';
const LABEL: Record<PhotoSide, string> = { front: 'Front photo file', back: 'Back photo file' };

function Thumb({ side, photo, squaring, onRetake, onRemove }: { side: PhotoSide; photo: DraftPhoto | undefined; squaring: boolean; onRetake: () => void; onRemove: () => void }) {
  const url = useBytesUrl(photo?.bytes ?? null);
  return (
    <PhotoThumb side={side} url={url} squaring={squaring} noEdges={photo?.foundEdges === false}>
      <Button variant="ghost" className={SMALL} onClick={onRetake}>Retake</Button>
      <Button variant="ghost" className={SMALL} onClick={onRemove}>Remove</Button>
    </PhotoThumb>
  );
}

/** The Add screen’s photo area: take front and back, see them squared, keep them as drafts. */
export function PhotoCapture() {
  const drafts = useDrafts();
  const tipsSeen = usePhotoTipsSeen();
  const [tipsOpen, setTipsOpen] = useState(false);
  const [afterTips, setAfterTips] = useState(false);
  const [squaring, setSquaring] = useState<Partial<Record<PhotoSide, boolean>>>({});
  const [askBack, setAskBack] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
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
      await saveDraft({ side, bytes, foundEdges });
      setAskBack(side === 'front');
    } catch {
      if (turn === taking.current[side]) setFailure('Couldn’t prepare that photo. Try again.');
    } finally {
      if (turn === taking.current[side]) setSquaring((s) => ({ ...s, [side]: false }));
    }
  }

  const front = useCamera((f) => void take('front', f), LABEL.front);
  const back = useCamera((f) => void take('back', f), LABEL.back);
  const camera: Record<PhotoSide, { open(): void }> = { front, back };

  function start() {
    if (!tipsSeen) {
      setAfterTips(true);
      setTipsOpen(true);
    } else front.open();
    warmUpSquaring(); // after the camera's click, never before it
  }

  function tipsDismissed() {
    setTipsOpen(false);
    setAfterTips(false);
  }

  function tipsDone() {
    setTipsOpen(false);
    if (afterTips) {
      setAfterTips(false);
      void markPhotoTipsSeen();
      front.open();
    }
  }

  function remove(side: PhotoSide) {
    taking.current[side]++;
    setSquaring((s) => ({ ...s, [side]: false }));
    if (side === 'front') setAskBack(false);
    void dropDraft(side);
  }

  const shown = PHOTO_SIDES.filter((side) => drafts?.[side] || squaring[side]);

  return (
    <section className="flex flex-col gap-3 px-4">
      {front.input}
      {back.input}
      {shown.length === 0 && (
        <Button disabled={tipsSeen === undefined || drafts === undefined} onClick={start} className={BIG}>
          Take photos
        </Button>
      )}
      {shown.length > 0 && (
        <div className="flex items-start gap-3">
          {shown.map((side) => (
            <Thumb
              key={side}
              side={side}
              photo={drafts?.[side]}
              squaring={!!squaring[side]}
              onRetake={() => camera[side].open()}
              onRemove={() => remove(side)}
            />
          ))}
        </div>
      )}
      {drafts?.front && !drafts.back && !squaring.back && !askBack && (
        <Button onClick={() => back.open()} className={SMALL}>Take the back</Button>
      )}
      {askBack && drafts?.front && !drafts.back && !squaring.back && (
        <div className="flex flex-col gap-2">
          <p className="text-[17px] font-semibold text-ink">Now the back</p>
          <Button onClick={() => back.open()} className={SMALL}>Take the back</Button>
          <Button variant="ghost" onClick={() => setAskBack(false)} className={SMALL}>Skip the back</Button>
        </div>
      )}
      {failure && (
        <p role="alert" className="text-[15px] text-brick-ink">
          {failure}
        </p>
      )}
      <Button
        variant="ghost"
        className={SMALL}
        onClick={() => {
          setAfterTips(false);
          setTipsOpen(true);
        }}
      >
        Photo tips
      </Button>
      <PhotoTips open={tipsOpen} onDone={tipsDone} onDismiss={tipsDismissed} />
    </section>
  );
}
