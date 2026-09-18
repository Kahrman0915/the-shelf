export const GRADE_KEYS = ['Sealed', 'M', 'NM', 'VG+', 'VG', 'G+', 'G', 'P'] as const;
export type Grade = (typeof GRADE_KEYS)[number];

export interface GradeInfo {
  key: Grade;
  word: string;
  help: string;
  /** Fraction of the Near Mint price. VG+ to G follow Goldmine; Sealed, M and P are our assumptions. */
  share: number;
}

export const GRADES: readonly GradeInfo[] = [
  { key: 'Sealed', word: 'Sealed', help: 'Still in the shrink. Unplayed.', share: 1.3 },
  { key: 'M', word: 'Perfect', help: 'Flawless. Rarely true of anything that has been played.', share: 1.15 },
  { key: 'NM', word: 'Near perfect', help: 'Played with care. No marks worth naming. The price reference.', share: 1 },
  { key: 'VG+', word: 'Light wear', help: 'A few faint marks. Plays clean. About half of NM.', share: 0.5 },
  { key: 'VG', word: 'Worn', help: 'Not "very good". Audible surface noise and light scratches. About a quarter of NM.', share: 0.25 },
  { key: 'G+', word: 'Heavy wear', help: 'Plays through with noise the whole way. About 15% of NM.', share: 0.15 },
  { key: 'G', word: 'Rough', help: 'Plays, just. Buy it only to hear it. About 10% of NM.', share: 0.1 },
  { key: 'P', word: 'Poor', help: 'Cracked, warped or skipping. Wall art.', share: 0.05 },
];

export function gradeInfo(grade: Grade): GradeInfo {
  const info = GRADES.find((g) => g.key === grade);
  if (!info) throw new Error(`Unknown grade: ${grade}`);
  return info;
}
