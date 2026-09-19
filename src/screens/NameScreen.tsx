import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** First sign-in only: the name that shows next to this person's ratings. */
export function NameScreen({ onSubmit }: { onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (clean === '' || clean.length > 40) {
      setError('A first name is enough, up to 40 letters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <form onSubmit={start} noValidate className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-display text-[28px] leading-7 tracking-[0.02em]">What should we call you?</span>
          <Input autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} className="h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk text-base" />
        </label>
        <p className="text-[15px] leading-[22px] text-ink-muted">It shows next to your ratings, like “Megan: Love it”.</p>
        <Button type="submit" disabled={busy} className="h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]">
          {busy ? 'Opening your shelf…' : 'Start'}
        </Button>
        {error && (
          <p role="alert" className="text-base text-brick-ink">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
