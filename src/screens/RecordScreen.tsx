import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice, useSyncStatus } from '@/app/SyncContext';
import { didntBuyIt, perform, rate } from '@/data/actions';
import { db } from '@/data/db';
import { useMembers, useRatings, useRecord } from '@/data/hooks';
import { formatMoney } from '@/domain/price';
import { GENRE_LABELS } from '@/domain/genres';
import { RATING_WORDS } from '@/domain/rating';
import { collectionTag } from '@/domain/shelf';
import { Poster } from '@/ui/Poster';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { RatingRecords } from '@/ui/RatingRecords';
import { StatusTag } from '@/ui/StatusTag';

function Grade({ part, grade }: { part: string; grade: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[13px] text-ink-muted">{part}</dt>
      <dd className={grade ? 'font-mono text-[15px] font-semibold' : 'text-[15px] text-ink-muted'}>{grade ?? 'not graded'}</dd>
    </div>
  );
}

export function RecordScreen() {
  const { id } = useParams();
  const { shelfId, userId } = useCurrentShelf();
  const record = useRecord(shelfId, id);
  const ratings = useRatings(id ?? '');
  const members = useMembers(shelfId);
  const navigate = useNavigate();
  const location = useLocation();
  const back = () => (location.key !== 'default' ? navigate(-1) : navigate('/'));

  const { runNow } = useSyncStatus();
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  async function onRate(value: number) {
    if (!record || saving) return;
    setSaving(true);
    setError(null);
    try {
      const wasArrival = record.status === 'new_arrival';
      const ctx = { me: userId, now: new Date().toISOString() };
      await perform(db, rate(record, value, ctx).postcards, runNow);
      setConfirmation(wasArrival ? `${RATING_WORDS[value]} · On the shelf · ${GENRE_LABELS[record.genre]}` : RATING_WORDS[value]);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  }

  async function onRemove() {
    if (!record) return;
    setAsking(false);
    setError(null);
    try {
      const ctx = { me: userId, now: new Date().toISOString() };
      await perform(db, didntBuyIt(record, ctx).postcards, runNow);
      navigate('/arrivals');
    } catch (e) {
      fail(e);
    }
  }

  const others = (members ?? []).filter((m) => m.userId !== userId);
  const mine = ratings?.find((r) => r.userId === userId)?.value;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))]">
        <Button variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold" onClick={back}>
          <ArrowLeft className="size-5" />
          Back
        </Button>
      </div>
      <SyncNotice />
      {record === undefined ? null : record === null ? (
        <p className="px-4 text-ink-muted">That record isn’t on this phone.</p>
      ) : (
        <>
          <Poster artist={record.artist} title={record.title} genre={record.genre} className="w-full" />
          <div className="flex flex-col gap-6 px-4">
            <div className="flex flex-col gap-2">
              <div className="w-fit">
                {record.status !== 'owned' || record.wantsUpgrade ? <StatusTag kind={collectionTag(record)} /> : null}
              </div>
              <h1 className="text-[22px] leading-7 font-bold">{record.artist}</h1>
              <div className="text-[17px] leading-[22px] text-ink-muted">{record.title}</div>
              <div className="font-mono text-xs font-medium uppercase tracking-[0.04em] text-ink-muted">
                {[record.year, record.label, record.catalog, record.format].filter((x) => x !== null && x !== '').join(' · ')}
              </div>
            </div>
            <dl className="flex gap-6">
              <Grade part="Disc" grade={record.discGrade} />
              <Grade part="Sleeve" grade={record.sleeveGrade} />
            </dl>
            {(record.status === 'new_arrival' || record.status === 'owned') && (
              <section className="flex flex-col gap-2">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Your rating</h2>
                <RatingRecords value={mine} onRate={onRate} disabled={saving} />
                {confirmation && <p role="status" className="text-[15px] font-semibold">{confirmation}</p>}
              </section>
            )}
            {error && <p role="alert" className="text-[15px] text-brick-ink">{error}</p>}
            {record.status === 'new_arrival' && (
              <>
                <Button variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold text-brick-ink" onClick={() => setAsking(true)}>
                  Didn’t buy it
                </Button>
                <ConfirmDialog
                  open={asking}
                  message={`Remove ${record.title} from New arrivals?`}
                  confirmLabel="Remove it"
                  cancelLabel="Keep it"
                  danger="confirm"
                  onConfirm={onRemove}
                  onCancel={() => setAsking(false)}
                />
              </>
            )}
            {others.length > 0 && (
              <ul className="flex flex-col gap-1 text-[15px]">
                {others.map((m) => {
                  const value = ratings?.find((r) => r.userId === m.userId)?.value;
                  return <li key={m.userId}>{`${m.displayName} · ${RATING_WORDS[value ?? 0]}`}</li>;
                })}
              </ul>
            )}
            {(record.notes || record.upgradeNote || record.valueNote) && (
              <div className="flex flex-col gap-2 text-[15px] leading-5">
                {record.notes && <p>{record.notes}</p>}
                {record.upgradeNote && <p>{record.upgradeNote}</p>}
                {record.valueNote && <p className="text-ink-muted">{record.valueNote}</p>}
              </div>
            )}
            {record.pricePaid !== null && <p className="text-[13px] text-ink-muted">{`Paid ${formatMoney(record.pricePaid)}`}</p>}
          </div>
        </>
      )}
    </main>
  );
}
