import type { SwatchKey } from '@/domain/sections';
import { POSTER_BAND, posterPlan } from '@/domain/poster';

/** `color`: the colour key of the record's section. */
export function Poster({ artist, title, color, className }: { artist: string; title: string; color: SwatchKey; className?: string }) {
  const plan = posterPlan(artist, title, color);
  return (
    <svg viewBox="0 0 300 300" role="img" aria-label={`Poster for ${artist}, ${title}`} className={className}>
      <rect x={0} y={0} width={300} height={300} fill="var(--surface)" />
      {plan.shapes.map((s, i) =>
        s.type === 'circle' ? (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={s.fill} />
        ) : (
          <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.fill} />
        ),
      )}
      <rect x={POSTER_BAND.x} y={POSTER_BAND.y} width={POSTER_BAND.w} height={POSTER_BAND.h} fill="var(--ink)" />
      <text x={12} y={262} fontFamily="var(--font-display)" fontSize={plan.artist.size} fill="var(--surface)">
        {plan.artist.text}
      </text>
      <text x={12} y={289} fontSize={12} fill="var(--surface)">
        {plan.title}
      </text>
    </svg>
  );
}
