// Reads every row of a query, a page at a time. PostgREST caps each response at 1000 rows, so a
// single read would silently drop the rest. Plain TypeScript, so Vitest can load it.

export const PAGE = 1000;

export type PageResult<T> = { data: T[] | null; error: { code?: string } | null };

/** Rows from `from` to `to` inclusive, in a stable order. Stops when a page comes back short. */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<{ data: T[]; error: null } | { data: null; error: { code?: string } }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error || data === null) return { data: null, error: error ?? {} };
    rows.push(...data);
    if (data.length < PAGE) return { data: rows, error: null };
  }
}
