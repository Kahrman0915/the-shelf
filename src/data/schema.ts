import { z } from 'zod';
import { GENRE_KEYS } from '@/domain/genres';
import { GRADE_KEYS } from '@/domain/grades';

const text = z.string().trim().min(1);
const optionalText = text.nullable();
const money = z.number().nonnegative().nullable();

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
  );

export type ShelfRecord = z.infer<typeof RecordSchema>;

export const RatingSchema = z.object({
  recordId: z.uuid(),
  userId: z.uuid(),
  value: z.number().int().min(1).max(5),
  updatedAt: z.string(),
});

export type Rating = z.infer<typeof RatingSchema>;
