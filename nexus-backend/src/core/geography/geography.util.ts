/**
 * Helpers for building the `places` ltree paths. ltree labels may only contain
 * [A-Za-z0-9_], so names are slugified into safe segments.
 */

/** Convert a place name into an ltree-safe slug (lowercase, underscores). */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

/** Build a child ltree path from a parent path and a name (parent '' → root). */
export function buildPath(parentPath: string, name: string): string {
  const seg = slugify(name);
  if (!seg) throw new Error(`Cannot build path segment from name: "${name}"`);
  return parentPath ? `${parentPath}.${seg}` : seg;
}
