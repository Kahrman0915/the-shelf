/** Shown only when the app itself can't start (e.g. missing configuration). */
export function BootError({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-12">
      <h1 className="font-display text-[44px] leading-[44px] text-brick-ink">Couldn’t open The Shelf</h1>
      <p className="text-ink">Nothing on this phone was changed. Here’s what went wrong:</p>
      <ul className="flex flex-col gap-1 font-mono text-sm text-ink">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </main>
  );
}
