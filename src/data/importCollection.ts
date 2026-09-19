import { z } from 'zod';
import { GENRE_KEYS } from '@/domain/genres';
import { GRADE_KEYS } from '@/domain/grades';
import { RecordSchema, type Rating, type ShelfRecord } from './schema';

const gradeOrBlank = z.union([z.enum(GRADE_KEYS), z.literal('')]);

const SeedRecord = z.object({
  id: z.string().min(1),
  artist: z.string(),
  title: z.string(),
  label: z.string(),
  catalog: z.string(),
  year: z.string(),
  format: z.string(),
  genre: z.enum(GENRE_KEYS),
  grade: gradeOrBlank,
  sleeveGrade: gradeOrBlank,
  rating: z.number().int().min(0).max(5),
  price: z.number().nonnegative(),
  valueLow: z.number().nonnegative(),
  valueHigh: z.number().nonnegative(),
  valueNote: z.string(),
  notes: z.string(),
  coverId: z.string().optional(),
  addedAt: z.number().int().positive(),
});

const SeedFile = z.object({ records: z.array(z.unknown()), wantlist: z.array(z.unknown()) });

export class ImportError extends Error {
  constructor(public problems: string[]) {
    super(`Import stopped. Nothing was saved.\n${problems.join('\n')}`);
    this.name = 'ImportError';
  }
}

function blank(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

function describe(issues: z.ZodError['issues']): string[] {
  return issues.map((i) => `${i.path.join('.') || '(record)'} ${i.message}`);
}

export function importCollection(
  json: unknown,
  ctx: { shelfId: string; userId: string; newId: () => string },
): { records: ShelfRecord[]; ratings: Rating[] } {
  const file = SeedFile.safeParse(json);
  if (!file.success) throw new ImportError(describe(file.error.issues).map((p) => `collection.json: ${p}`));

  const problems: string[] = [];
  const records: ShelfRecord[] = [];
  const ratings: Rating[] = [];

  file.data.records.forEach((raw, index) => {
    const rawId = (raw as { id?: unknown } | null)?.id;
    const name = typeof rawId === 'string' && rawId ? rawId : `record #${index + 1}`;

    const seed = SeedRecord.safeParse(raw);
    if (!seed.success) {
      describe(seed.error.issues).forEach((p) => problems.push(`${name}: ${p}`));
      return;
    }
    const s = seed.data;
    const id = ctx.newId();
    const created = new Date(s.addedAt).toISOString();
    const year = blank(s.year);

    const checked = RecordSchema.safeParse({
      id,
      shelfId: ctx.shelfId,
      status: 'owned',
      wantsUpgrade: false,
      upgradeNote: null,
      artist: s.artist.trim(),
      title: s.title.trim(),
      label: blank(s.label),
      catalog: blank(s.catalog),
      year: year === null ? null : Number(year),
      format: blank(s.format),
      genre: s.genre,
      discGrade: s.grade === '' ? null : s.grade,
      sleeveGrade: s.sleeveGrade === '' ? null : s.sleeveGrade,
      pricePaid: s.price > 0 ? s.price : null,
      nmEstimateLow: s.valueLow,
      nmEstimateHigh: s.valueHigh,
      valueNote: blank(s.valueNote),
      notes: blank(s.notes),
      discogsReleaseId: null,
      coverPath: null,
      boughtAt: null,
      addedBy: ctx.userId,
      createdAt: created,
      updatedAt: created,
      deletedAt: null,
      importKey: s.id,
    });
    if (!checked.success) {
      describe(checked.error.issues).forEach((p) => problems.push(`${name}: ${p}`));
      return;
    }
    records.push(checked.data);
    if (s.rating > 0) ratings.push({ recordId: id, userId: ctx.userId, value: s.rating, updatedAt: created });
  });

  if (file.data.wantlist.length > 0) {
    problems.push(`wantlist: found ${file.data.wantlist.length} entries; importing a want list isn't built yet`);
  }
  if (problems.length > 0) throw new ImportError(problems);
  return { records, ratings };
}
