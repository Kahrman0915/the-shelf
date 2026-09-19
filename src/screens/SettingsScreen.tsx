import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useBackend } from '@/app/BackendContext';
import { useCurrentShelf } from '@/app/CurrentShelf';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Invite } from '@/data/backend';
import { useMembers } from '@/data/hooks';

const SECTION = 'font-display text-[28px] leading-7 tracking-[0.02em]';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SettingsScreen() {
  const backend = useBackend();
  const { shelfId, userId, signOut } = useCurrentShelf();
  const members = useMembers(shelfId);
  const isOwner = members?.some((m) => m.userId === userId && m.role === 'owner') ?? false;
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    try {
      setInvites(await backend.invites(shelfId));
      setInvitesError(null);
    } catch (e) {
      setInvitesError(e instanceof Error ? e.message : String(e));
    }
  }, [backend, shelfId]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean)) {
      setError('That doesn’t look like an email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.invite(shelfId, clean, userId);
      setEmail('');
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const waiting = invites?.filter((i) => i.acceptedAt === null) ?? [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 pt-[max(1.5rem,calc(env(safe-area-inset-top)+1rem))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <Button asChild variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold">
        <Link to="/">
          <ArrowLeft className="size-5" />
          Back to the shelf
        </Link>
      </Button>
      <h1 className="font-display text-[56px] leading-[52px] tracking-[0.01em]">Shelf settings</h1>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION}>On this shelf</h2>
        <ul className="flex flex-col border-t border-line">
          {(members ?? []).map((m) => (
            <li key={m.userId} className="flex min-h-12 items-center justify-between border-b border-line">
              <span className="text-[17px] font-bold">{m.displayName}</span>
              {m.role === 'owner' && <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Owner</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION}>Invite someone</h2>
        {isOwner ? (
          <form onSubmit={sendInvite} noValidate className="flex flex-col gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-muted">Their email</span>
              <Input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-lg border-[1.5px] border-line-strong bg-surface-sunk text-base" />
            </label>
            <p className="text-[15px] leading-[22px] text-ink-muted">They join this shelf the next time they sign in with that email.</p>
            <Button type="submit" disabled={busy} className="h-12 rounded-lg font-display text-[22px] tracking-[0.04em]">
              {busy ? 'Sending…' : 'Send invite'}
            </Button>
            {error && (
              <p role="alert" className="text-base text-brick-ink">
                {error}
              </p>
            )}
          </form>
        ) : (
          <p className="text-ink-muted">Only the shelf’s owner can invite people.</p>
        )}
        {invitesError && <p className="text-[15px] text-ink-muted">Invites need signal. {invitesError}</p>}
        {waiting.length > 0 && (
          <ul className="flex flex-col border-t border-line">
            {waiting.map((i) => (
              <li key={i.email} className="flex min-h-12 flex-col justify-center border-b border-line py-2">
                <span className="text-base">{i.email}</span>
                <span className="text-[13px] text-ink-muted">Waiting for them to sign in</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <Button variant="outline" className="h-12 rounded-lg border-[1.5px] border-line-strong bg-transparent text-[15px] font-semibold" onClick={() => void signOut()}>
          Sign out
        </Button>
        <p className="text-[15px] leading-[22px] text-ink-muted">Signing out clears the shelf from this phone. It stays safe in your account.</p>
      </section>
    </main>
  );
}
