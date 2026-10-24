/** Validate the positional author/affiliation correspondence without changing metadata. */
export const isValidAuthorAffiliations = (
  authors: readonly string[],
  value: unknown
): value is string[][] =>
  Array.isArray(value) &&
  value.length === authors.length &&
  Array.from(value).every(
    (row) =>
      Array.isArray(row) && Array.from(row).every((affiliation) => typeof affiliation === "string")
  );
