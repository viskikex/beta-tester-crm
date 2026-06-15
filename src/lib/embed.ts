// Normalize a PostgREST one-to-one embed.
//
// `select("*, submitter:profiles(email)")` is logically a single related row, but
// PostgREST returns the embed as an ARRAY when it can't prove the relationship is
// to-one (FK direction / inference). When that happens, `row.submitter?.email`
// reads `undefined` off the array and the email silently renders as "unknown".
// Run the embed through one() at the fetch boundary so callers always see T | null.
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
