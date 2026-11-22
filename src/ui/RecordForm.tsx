import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RecordFields } from '@/data/actions';
import { SHELF_LOADING } from '@/data/backend';
import type { Section, ShelfRecord } from '@/data/schema';
import { sanitizeAsking } from '@/domain/price';
import { emptyForm, findDuplicate, isDirty, parseRecordForm, type FormErrors, type RecordFormValues } from '@/domain/recordForm';
import { useUnsavedMark } from '@/app/useUnsavedMark';
import { cn } from '@/lib/utils';
import { GradePicker } from './GradePicker';
import { RatingRecords } from './RatingRecords';
import { SECTION_ITEM_CLASS } from './SectionSelect';

type Props = {
  mode: 'add' | 'edit';
  initial: RecordFormValues;
  /** The shelf's sections, in shelf order, for the Section picker. */
  sections: Section[];
  /** For the duplicate check. */
  records: ShelfRecord[];
  /** Edit: the record itself, which is never its own duplicate. */
  excludeId?: string;
  onSave: (fields: RecordFields, opts: { rating: number | null; another: boolean }) => Promise<void>;
  onOpenDuplicate: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Edit: the Delete record link. */
  footer?: ReactNode;
  /** The form element's id, so a button elsewhere on the screen can submit it. */
  formId?: string;
};

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted';
const INPUT = 'h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base';
const TEXTAREA = 'min-h-24 w-full rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 py-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const ERROR = 'text-[15px] text-brick-ink';

/** Top to bottom, so focus lands on the first problem a person would see. */
const FIELD_ORDER: (keyof RecordFormValues)[] = ['artist', 'title', 'sectionId', 'year', 'funFact', 'funFactSource', 'nmLow', 'nmHigh', 'pricePaid'];
const DETAIL_FIELDS: (keyof RecordFormValues)[] = ['year', 'funFact', 'funFactSource', 'nmLow', 'nmHigh', 'pricePaid'];

const fieldId = (name: keyof RecordFormValues) => `rf-${name}`;

export function RecordForm({ mode, initial, sections, records, excludeId, onSave, onOpenDuplicate, onDirtyChange, footer, formId }: Props) {
  const [opened, setOpened] = useState(initial);
  const [values, setValues] = useState(initial);
  const [rating, setRating] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(mode === 'edit');
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  // A ref, not just state: two taps before React re-renders must save one record.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const focusErrors = useRef(false);

  const dirty = isDirty(opened, values);
  useUnsavedMark(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // After a failed Save, move to the first field with an error (once the expander, if needed, has opened).
  useEffect(() => {
    if (!focusErrors.current) return;
    focusErrors.current = false;
    const first = FIELD_ORDER.find((k) => errors[k]);
    if (first) document.getElementById(fieldId(first))?.focus();
  }, [errors, expanded]);

  const set = <K extends keyof RecordFormValues>(key: K, value: RecordFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const duplicate = findDuplicate(records, values.artist, values.title, excludeId);

  async function submit(another: boolean) {
    if (saving.current) return;
    const parsed = parseRecordForm(values);
    if (!parsed.ok) {
      focusErrors.current = true;
      if (DETAIL_FIELDS.some((k) => parsed.errors[k])) setExpanded(true);
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setFailure(null);
    saving.current = true;
    setBusy(true);
    try {
      await onSave(parsed.fields, { rating: mode === 'add' ? rating : null, another });
      if (another) {
        const next = emptyForm({ sectionId: parsed.fields.sectionId, label: parsed.fields.label ?? '' });
        setOpened(next);
        setValues(next);
        setRating(null);
        saving.current = false;
        setBusy(false);
        document.getElementById(fieldId('artist'))?.focus();
      } else {
        // Held busy: the screen moves on. What was saved is now what the form opened as.
        setOpened(values);
      }
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      saving.current = false;
      setBusy(false);
    }
  }

  const err = (name: keyof RecordFormValues) => ({
    'aria-invalid': errors[name] ? (true as const) : undefined,
    'aria-describedby': errors[name] ? `${fieldId(name)}-error` : undefined,
  });
  const errorLine = (name: keyof RecordFormValues) =>
    errors[name] && (
      <p id={`${fieldId(name)}-error`} className={ERROR}>
        {errors[name]}
      </p>
    );

  const text = (name: keyof RecordFormValues, label: string, extra: { inputMode?: 'numeric' | 'decimal'; money?: boolean } = {}) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId(name)} className={LABEL}>{label}</label>
      <Input
        id={fieldId(name)}
        value={values[name] ?? ''}
        inputMode={extra.inputMode}
        onChange={(e) => set(name, (extra.money ? sanitizeAsking(e.target.value) : e.target.value) as never)}
        className={INPUT}
        {...err(name)}
      />
      {errorLine(name)}
    </div>
  );

  const area = (name: 'notes' | 'funFact', label: string) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId(name)} className={LABEL}>{label}</label>
      <textarea id={fieldId(name)} value={values[name]} onChange={(e) => set(name, e.target.value)} className={TEXTAREA} {...err(name)} />
      {errorLine(name)}
    </div>
  );

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      className="flex flex-col gap-5 px-4"
    >
      {text('artist', 'Artist')}
      <div className="flex flex-col gap-2">
        {text('title', 'Title')}
        {duplicate && (
          <p className="flex flex-wrap items-center gap-x-3 text-[15px] text-ink-muted">
            <span>Already on the shelf: {duplicate.title} ({duplicate.discGrade ?? 'no grade'})</span>
            <button type="button" onClick={() => onOpenDuplicate(duplicate.id)} className="min-h-12 font-semibold text-ink underline underline-offset-2">
              Open it
            </button>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId('sectionId')} className={LABEL}>Section</label>
        <Select value={values.sectionId} onValueChange={(id) => set('sectionId', id)} disabled={sections.length === 0}>
          <SelectTrigger
            id={fieldId('sectionId')}
            className="w-full rounded-lg border-[1.5px] border-line-strong bg-surface-sunk px-4 text-base text-ink data-[size=default]:h-12 [&_svg]:text-ink-muted"
            {...err('sectionId')}
            aria-describedby={errors.sectionId ? `${fieldId('sectionId')}-error` : sections.length === 0 ? `${fieldId('sectionId')}-loading` : undefined}
          >
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent className="rounded-lg">
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id} className={SECTION_ITEM_CLASS}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sections.length === 0 && (
          <p id={`${fieldId('sectionId')}-loading`} className="text-[15px] text-ink-muted">
            {SHELF_LOADING}
          </p>
        )}
        {errorLine('sectionId')}
      </div>

      <GradePicker value={values.discGrade} onChange={(g) => set('discGrade', g)} part="Disc" />

      {mode === 'add' && (
        <div className="flex flex-col gap-2">
          <div className={LABEL}>Your rating · optional</div>
          <RatingRecords value={rating ?? undefined} onRate={setRating} disabled={busy} />
        </div>
      )}

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="rf-more"
        onClick={() => setExpanded((x) => !x)}
        className="flex min-h-12 items-center justify-between rounded-lg border-[1.5px] border-line-strong px-4 text-base font-semibold text-ink"
      >
        More details
        <span aria-hidden className={cn('transition-transform', expanded && 'rotate-180')}>⌄</span>
      </button>

      {expanded && (
        <div id="rf-more" className="flex flex-col gap-5">
          {text('label', 'Label')}
          {text('catalog', 'Catalog')}
          {text('year', 'Year', { inputMode: 'numeric' })}
          {text('format', 'Pressing')}
          <GradePicker value={values.sleeveGrade} onChange={(g) => set('sleeveGrade', g)} part="Sleeve" />
          {area('notes', 'Notes')}
          {area('funFact', 'Fun fact')}
          {text('funFactSource', 'Fun fact source')}
          {text('nmLow', 'NM estimate low', { inputMode: 'decimal', money: true })}
          {text('nmHigh', 'NM estimate high', { inputMode: 'decimal', money: true })}
          {text('valueNote', 'Value note')}
          {text('pricePaid', 'Price paid', { inputMode: 'decimal', money: true })}
        </div>
      )}

      {failure && <p role="alert" className={ERROR}>{failure}</p>}

      <div className="flex flex-col gap-3">
        <Button type="submit" disabled={busy} className="h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]">
          Save
        </Button>
        {mode === 'add' && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(true)} className="h-12 w-full rounded-lg text-base font-semibold">
            Save and add another
          </Button>
        )}
      </div>
      {footer}
    </form>
  );
}
