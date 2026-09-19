import { cn } from '@/lib/utils';
import type { TagKind } from '@/domain/shelf';

const TAGS: Record<TagKind, { label: string; className: string }> = {
  own: { label: 'Own it', className: 'bg-ink text-surface' },
  want: { label: 'Want list', className: 'bg-bourbon-soft text-bourbon-ink' },
  upgrade: { label: 'Upgrade', className: 'bg-teal-soft text-teal-ink' },
  new: { label: 'New arrival', className: 'bg-brick-soft text-brick-ink' },
  disliked: { label: "Didn't love it", className: 'text-ink-muted ring-1 ring-inset ring-line-strong' },
};

export function StatusTag({ kind }: { kind: TagKind }) {
  const tag = TAGS[kind];
  return (
    <span className={cn('inline-flex min-h-6 items-center whitespace-nowrap rounded-xs px-2 text-[11px] font-semibold uppercase tracking-[0.12em]', tag.className)}>
      {tag.label}
    </span>
  );
}
