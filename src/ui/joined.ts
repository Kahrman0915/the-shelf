/** Joins the parts that are there with ` · `, leaving out the empty ones. */
export const joined = (parts: (string | number | null)[]) => parts.filter((p) => p !== null && p !== '').join(' · ');
