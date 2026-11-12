import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice, useSyncStatus } from '@/app/SyncContext';
import { useUndo } from '@/app/UndoContext';
import { deleteRecord, editRecord, FORM_FIELDS, perform, restoreWithEdits, type RecordFields } from '@/data/actions';
import { db } from '@/data/db';
import { useRecordAnyState, useShelfItems } from '@/data/hooks';
import type { ShelfRecord } from '@/data/schema';
import { formFromRecord, parseRecordForm, type RecordFormValues } from '@/domain/recordForm';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { RecordForm } from '@/ui/RecordForm';

const FORM_ID = 'edit-record';

type Opened = { values: RecordFormValues; fields: RecordFields };

/**
 * What the form opened with, read the way the form would save it, so legacy untrimmed or empty text can't look like a
 * change. A stored value the form's rules wouldn't accept is compared as stored.
 */
function openedFrom(r: ShelfRecord): Opened {
  const values = formFromRecord(r);
  const parsed = parseRecordForm(values);
  const fields = parsed.ok ? parsed.fields : (Object.fromEntries(FORM_FIELDS.map((k) => [k, r[k]])) as RecordFields);
  return { values, fields };
}

export function EditScreen() {
  const { id } = useParams();
  const { shelfId, userId } = useCurrentShelf();
  const record = useRecordAnyState(shelfId, id);
  const items = useShelfItems(shelfId, userId);
  const records = useMemo(() => (items ?? []).map((i) => i.record), [items]);
  const { runNow } = useSyncStatus();
  const { offer } = useUndo();
  const navigate = useNavigate();
  const location = useLocation();

  // Frozen when the record first arrives: a later sync never changes what an edit is compared against.
  const [opened, setOpened] = useState<Opened | null>(null);
  if (opened === null && record && record.deletedAt === null) setOpened(openedFrom(record));

  const [dirty, setDirty] = useState(false);
  // Where to go once the person agrees to discard: null means no question is open.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [asking, setAsking] = useState(false);
  // Set before this screen deletes, so its own delete isn't taken for one from another phone.
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reloading or closing the tab. (The system back gesture isn't guarded; see the plan's ruling.)
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, [dirty]);

  // Edit is opened from the record, so going back returns to it; opened directly, it replaces itself with the record.
  const toRecord = () => (location.key !== 'default' ? navigate(-1) : navigate(`/record/${id}`, { replace: true }));
  const leave = (go: () => void) => (dirty ? setLeaving(() => go) : go());

  const deletedElsewhere = !!record && record.deletedAt !== null && !deleting;

  async function onSave(fields: RecordFields) {
    if (!record || !opened) throw new Error('That record isn’t on this phone.');
    const ctx = { me: userId, now: new Date().toISOString() };
    // Deleted on another phone: saving brings it back with these changes, the same as Restore with your changes.
    const { postcards } =
      record.deletedAt !== null ? restoreWithEdits(record, opened.fields, fields, ctx) : editRecord(record, opened.fields, fields, ctx);
    if (postcards.length > 0) await perform(db, postcards, runNow);
    toRecord();
  }

  async function onDelete() {
    if (!record) return;
    setAsking(false);
    setError(null);
    setDeleting(true);
    try {
      const { postcards, undo } = deleteRecord(record, { me: userId, now: new Date().toISOString() });
      await perform(db, postcards, runNow);
      navigate('/');
      offer(`Deleted ${record.title}`, () => perform(db, undo!, runNow));
    } catch (e) {
      setDeleting(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))]">
        <Button variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold" onClick={() => leave(toRecord)}>
          ‹ Back
        </Button>
      </div>
      <SyncNotice />
      {record === undefined ? null : record === null || opened === null ? (
        <p className="px-4 text-ink-muted">That record isn’t on this phone.</p>
      ) : (
        <>
          <h1 className="px-4 font-display text-[44px] leading-[44px] tracking-[0.01em]">Edit</h1>
          {deletedElsewhere && (
            <div role="alert" className="mx-4 flex flex-col gap-3 rounded-lg border-[1.5px] border-brick p-4">
              <p className="text-[15px] font-semibold">That record was deleted on another phone.</p>
              <Button type="submit" form={FORM_ID} className="h-12 w-full rounded-lg text-base font-semibold">
                Restore with your changes
              </Button>
              <Button variant="outline" className="h-12 w-full rounded-lg text-base font-semibold" onClick={() => navigate('/')}>
                Leave it deleted
              </Button>
            </div>
          )}
          <RecordForm
            mode="edit"
            formId={FORM_ID}
            initial={opened.values}
            records={records}
            excludeId={record.id}
            onSave={onSave}
            onOpenDuplicate={(other) => leave(() => navigate(`/record/${other}`))}
            onDirtyChange={setDirty}
            footer={
              deletedElsewhere ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold text-brick-ink"
                  onClick={() => setAsking(true)}
                >
                  Delete record
                </Button>
              )
            }
          />
          {error && <p role="alert" className="px-4 text-[15px] text-brick-ink">{error}</p>}
          <ConfirmDialog
            open={asking}
            message={`Delete ${record.title}? It goes from both your shelves.`}
            confirmLabel="Delete"
            cancelLabel="Keep it"
            danger="confirm"
            onConfirm={() => void onDelete()}
            onCancel={() => setAsking(false)}
          />
        </>
      )}
      <ConfirmDialog
        open={leaving !== null}
        message="Discard your changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger="confirm"
        onConfirm={() => {
          const go = leaving;
          setLeaving(null);
          go?.();
        }}
        onCancel={() => setLeaving(null)}
      />
    </main>
  );
}
