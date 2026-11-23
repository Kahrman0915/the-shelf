import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Switch } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { SyncNotice, useSyncStatus } from '@/app/SyncContext';
import { useUndo } from '@/app/UndoContext';
import { useLeaveGuard } from '@/app/useLeaveGuard';
import { useUnsavedMark } from '@/app/useUnsavedMark';
import { deleteRecord, editRecord, FORM_FIELDS, perform, restoreWithEdits, type RecordFields } from '@/data/actions';
import { db } from '@/data/db';
import { useRecordAnyState, useSections, useShelfItems } from '@/data/hooks';
import { upgradeChange } from '@/data/wantActions';
import { editPhotos, type PhotoChanges } from '@/data/photos';
import type { ShelfRecord } from '@/data/schema';
import { formFromRecord, parseRecordForm, type RecordFormValues } from '@/domain/recordForm';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EditPhotos } from '@/ui/EditPhotos';
import { RecordForm } from '@/ui/RecordForm';

const FORM_ID = 'edit-record';

type Opened = { values: RecordFormValues; fields: RecordFields; upgrade: Upgrade };
type Upgrade = { wants: boolean; note: string };

/**
 * What the form opened with, read the way the form would save it, so legacy untrimmed or empty text can't look like a
 * change. A stored value the form's rules wouldn't accept is compared as stored.
 */
function openedFrom(r: ShelfRecord): Opened {
  const values = formFromRecord(r);
  const parsed = parseRecordForm(values);
  const fields = parsed.ok ? parsed.fields : (Object.fromEntries(FORM_FIELDS.map((k) => [k, r[k]])) as RecordFields);
  return { values, fields, upgrade: { wants: r.wantsUpgrade, note: r.upgradeNote ?? '' } };
}

export function EditScreen() {
  const { id } = useParams();
  const { shelfId, userId } = useCurrentShelf();
  const record = useRecordAnyState(shelfId, id);
  const items = useShelfItems(shelfId, userId);
  const records = useMemo(() => (items ?? []).map((i) => i.record), [items]);
  const sections = useSections(shelfId);
  const { runNow } = useSyncStatus();
  const { offer } = useUndo();
  const navigate = useNavigate();
  const location = useLocation();

  // Frozen when the record first arrives: a later sync never changes what an edit is compared against.
  const [opened, setOpened] = useState<Opened | null>(null);
  if (opened === null && record && record.deletedAt === null) setOpened(openedFrom(record));

  const [formDirty, setFormDirty] = useState(false);
  // Our call: photo changes live only in memory. If iOS reloads the page while the camera is open, they are lost,
  // along with any typed changes, as the form's already are.
  const [photoChanges, setPhotoChanges] = useState<PhotoChanges>({});
  const photosDirty = Object.keys(photoChanges).length > 0;
  // The upgrade switch and note (owned records only), until touched they are what the record opened with.
  const [upgradeEdit, setUpgradeEdit] = useState<Upgrade | null>(null);
  const upgrade = upgradeEdit ?? opened?.upgrade ?? { wants: false, note: '' };
  const canUpgrade = record?.status === 'owned';
  const upgradeDirty =
    canUpgrade && opened !== null && (upgrade.wants !== opened.upgrade.wants || upgrade.note.trim() !== opened.upgrade.note.trim());
  useUnsavedMark(photosDirty || upgradeDirty);
  const { leave, dialog } = useLeaveGuard(formDirty || photosDirty || upgradeDirty);
  const [asking, setAsking] = useState(false);
  // Set before this screen deletes, so its own delete isn't taken for one from another phone.
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit is opened from the record, so going back returns to it; opened directly, it replaces itself with the record.
  const toRecord = () => (location.key !== 'default' ? navigate(-1) : navigate(`/record/${id}`, { replace: true }));

  const deletedElsewhere = !!record && record.deletedAt !== null && !deleting;

  async function onSave(fields: RecordFields) {
    if (!record || !opened) throw new Error('That record isn’t on this phone.');
    const ctx = { me: userId, now: new Date().toISOString() };
    // Deleted on another phone: saving brings it back with these changes, the same as Restore with your changes.
    const ph = editPhotos(record, photoChanges, { ...ctx, photoId: () => crypto.randomUUID() });
    const extra = canUpgrade ? { ...ph.fields, ...upgradeChange(record, upgrade.wants, upgrade.note) } : ph.fields;
    const { postcards } =
      record.deletedAt !== null
        ? restoreWithEdits(record, opened.fields, fields, ctx, extra)
        : editRecord(record, opened.fields, fields, ctx, extra);
    if (postcards.length > 0) await perform(db, [...ph.uploads, ...postcards, ...ph.deletes], runNow, ph.photos);
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
          <EditPhotos record={record} changes={photoChanges} onChange={setPhotoChanges} />
          <RecordForm
            mode="edit"
            formId={FORM_ID}
            initial={opened.values}
            sections={sections}
            records={records}
            excludeId={record.id}
            onSave={onSave}
            onOpenDuplicate={(other) => leave(() => navigate(`/record/${other}`))}
            onDirtyChange={setFormDirty}
            footer={
              <>
                {canUpgrade && (
                  <div className="flex flex-col gap-3">
                    <div className="flex min-h-12 items-center justify-between gap-3">
                      <label htmlFor="edit-wants-upgrade" className="text-[17px] font-semibold text-ink">
                        Want a better copy
                      </label>
                      <Switch.Root
                        id="edit-wants-upgrade"
                        checked={upgrade.wants}
                        onCheckedChange={(wants) => setUpgradeEdit({ ...upgrade, wants })}
                        className="relative h-12 w-14 flex-none rounded-full bg-line-strong data-[state=checked]:bg-bourbon"
                      >
                        <Switch.Thumb className="block size-6 translate-x-1 rounded-full bg-surface-raised transition-transform data-[state=checked]:translate-x-7" />
                      </Switch.Root>
                    </div>
                    {upgrade.wants && (
                      <div className="flex flex-col gap-2">
                        <label htmlFor="edit-upgrade-note" className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                          Upgrade note
                        </label>
                        <input
                          id="edit-upgrade-note"
                          type="text"
                          maxLength={200}
                          value={upgrade.note}
                          onChange={(e) => setUpgradeEdit({ ...upgrade, note: e.target.value })}
                          className="min-h-12 w-full rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base text-ink focus-visible:outline-2 focus-visible:outline-ring"
                        />
                      </div>
                    )}
                  </div>
                )}
                {deletedElsewhere ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold text-brick-ink"
                  onClick={() => setAsking(true)}
                >
                  Delete record
                </Button>
                )}
              </>
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
      {dialog}
    </main>
  );
}
