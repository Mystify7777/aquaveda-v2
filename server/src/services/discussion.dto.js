/**
 * Public Discussion projection.
 *
 * Explicit allowlist: Community public reads expose only the fields locked
 * by ADR-0009. No storage internals, moderation data, email, or credentials.
 */
export function toPublicDiscussionDTO(doc) {
  const d = typeof doc?.toObject === "function" ? doc.toObject() : doc;

  const author = d?.author
    ? {
        _id: String(d.author._id),
        name: d.author.name,
        role: d.author.role,
      }
    : null;

  return {
    _id: String(d._id),
    title: d.title,
    body: d.body,
    category: d.category,
    status: d.status,
    author,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
