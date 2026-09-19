import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Backend, SignedIn } from '@/data/backend';
import { ShelfIntro } from '@/ui/ShelfIntro';

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted';
const PRIMARY = 'h-12 w-full rounded-lg font-display text-[22px] tracking-[0.04em]';
const FIELD = 'h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk text-base';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Step = { name: 'email' } | { name: 'code'; email: string };

/** Email → 6-digit code. No passwords, and no magic links (they open Safari, not the home-screen app). */
export function SignInScreen({ backend, onVerified }: { backend: Backend; onVerified: (user: SignedIn) => void | Promise<void> }) {
  const [step, setStep] = useState<Step>({ name: 'email' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean)) {
      setError('That doesn’t look like an email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.sendCode(clean);
      setCode('');
      setStep({ name: 'code', email: clean });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (step.name !== 'code') return;
    if (!/^\d{6}$/.test(code)) {
      setError('The code is 6 digits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onVerified(await backend.verifyCode(step.email, code));
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <ShelfIntro>
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
        <h1 aria-hidden="true" className="font-display text-[56px] leading-[52px] tracking-[0.01em]">The Shelf</h1>
        {step.name === 'email' ? (
          <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className={LABEL}>Your email</span>
              <Input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
            </label>
            <p className="text-[15px] leading-[22px] text-ink-muted">We’ll email you a 6-digit code. No password.</p>
            <Button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? 'Sending…' : 'Send my code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={signIn} noValidate className="flex flex-col gap-4">
            <p className="text-base text-ink">We sent a 6-digit code to {step.email}.</p>
            <label className="flex flex-col gap-2">
              <span className={LABEL}>Code</span>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="h-14 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk font-mono text-[28px] tracking-[0.3em]"
              />
            </label>
            <Button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="ghost" className="h-12 px-3" onClick={() => { setStep({ name: 'email' }); setError(null); }}>
                Use a different email
              </Button>
              <Button type="button" variant="ghost" className="h-12 px-3" disabled={busy} onClick={() => void sendCode()}>
                Send a new code
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="text-base text-brick-ink">
            {error}
          </p>
        )}
      </main>
    </ShelfIntro>
  );
}
