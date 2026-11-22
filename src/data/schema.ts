import { z } from 'zod';
import { BackendError } from './backend';
import { GENRE_KEYS } from '@/domain/genres';
import { GRADE_KEYS } from '@/domain/grades';
import { DISCOGS_GENRES, LEGACY_GENRES, SWATCH_KEYS } from '@/domain/sections';

const text = z.string().trim().min(1);
const optionalText = text.nullable();
const httpsLink = z.string().startsWith('https://').nullable();
/** numeric(8,2) on the server: under a million. */
export const MONEY_MAX = 999999.99;
const money = z.number().nonnegative().max(MONEY_MAX).nullable();

export const RecordSchema = z
  .object({
    id: z.uuid(),
    shelfId: z.uuid(),
    status: z.enum(['wanted', 'new_arrival', 'owned']),
    wantsUpgrade: z.boolean(),
    upgradeNote: optionalText,
    artist: text,
    title: text,
    label: optionalText,
    catalog: optionalText,
    year: z.number().int().min(1900).max(2100).nullable(),
    format: optionalText,
    genre: z.enum(GENRE_KEYS),
    discGrade: z.enum(GRADE_KEYS).nullable(),
    sleeveGrade: z.enum(GRADE_KEYS).nullable(),
    pricePaid: money,
    nmEstimateLow: money,
    nmEstimateHigh: money,
    valueNote: optionalText,
    notes: optionalText,
    discogsReleaseId: z.number().int().positive().nullable(),
    coverPath: optionalText,
    backPath: optionalText,
    funFact: z.string().trim().min(1).max(500).nullable(),
    funFactSource: httpsLink,
    coverImageUrl: httpsLink,
    boughtAt: z.string().nullable(),
    addedBy: z.uuid(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
    importKey: optionalText,
  })
  .refine(
    (r) => (r.nmEstimateLow === null) === (r.nmEstimateHigh === null) && (r.nmEstimateLow === null || r.nmEstimateLow <= (r.nmEstimateHigh ?? 0)),
    { message: 'needs both low and high, with low ≤ high', path: ['nmEstimateLow'] },
  )
  .refine((r) => r.funFactSource === null || r.funFact !== null, { message: 'needs a fun fact', path: ['funFactSource'] });

export type ShelfRecord = z.infer<typeof RecordSchema>;

export const RatingSchema = z.object({
  recordId: z.uuid(),
  userId: z.uuid(),
  value: z.number().int().min(1).max(5),
  updatedAt: z.string(),
});

export type Rating = z.infer<typeof RatingSchema>;

/** A divider on one shelf. Its id is a guid, not a v4 uuid: the ones made for the two starting sets are derived (see sectionIdFor). */
export const SectionSchema = z.object({
  id: z.guid(),
  shelfId: z.uuid(),
  name: z.string().trim().min(1).max(40),
  color: z.enum(SWATCH_KEYS),
  position: z.number().int(),
  discogsGenres: z.array(z.enum(DISCOGS_GENRES)),
  takesHoliday: z.boolean(),
  isCatchAll: z.boolean(),
  legacyGenre: z.enum(LEGACY_GENRES),
  updatedAt: z.string(),
});

export type Section = z.infer<typeof SectionSchema>;

/** Check a whole section against the section rules; throw naming the first broken field. */
export function checkSection(section: unknown): Section {
  const parsed = SectionSchema.safeParse(section);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BackendError(`Section rules broken: ${issue.path.join('.') || 'section'} ${issue.message}`);
  }
  return parsed.data;
}
