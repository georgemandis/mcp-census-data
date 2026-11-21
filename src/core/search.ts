/** Lower-cases and splits on anything that is not a letter or digit. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export interface SearchFields {
  /** Identifier (dataset id, variable code). An exact match ranks first. */
  id: string;
  /** The main human-readable text (title, label). */
  primary: string;
  /** Supporting text (description, concept). */
  secondary?: string;
  /** Added to the score; used to prefer curated entries. */
  boost?: number;
}

/**
 * Keeps items where every query word appears somewhere in id, primary or
 * secondary, in any order. Best matches first; on an equal score the shorter
 * text wins, since it is the more specific match ("Median household income"
 * ahead of "Median nonfamily household income ... two or more races"). Pass
 * preferShorter: false when input order is itself meaningful.
 */
export function rank<T>(
  items: T[],
  query: string,
  fields: (item: T) => SearchFields,
  options: { preferShorter?: boolean } = {}
): T[] {
  const preferShorter = options.preferShorter ?? true;
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const wanted = query.trim().toLowerCase();
  const phrase = tokens.join(" ");

  const scored: Array<{ item: T; score: number; length: number; index: number }> = [];
  items.forEach((item, index) => {
    const f = fields(item);
    const id = f.id.toLowerCase();
    const primary = f.primary.toLowerCase();
    const all = `${id} ${primary} ${(f.secondary ?? "").toLowerCase()}`;
    if (!tokens.every((t) => all.includes(t))) return;

    let score = 1 + (f.boost ?? 0);
    if (id === wanted) score += 100;
    if (primary.startsWith(tokens[0])) score += 50;
    // Compare as plain words so "Estimate!!Median household income" and
    // "Median Household Income" both read as phrases.
    const fieldsAsWords = [f.primary, f.secondary ?? ""].map((t) => tokenize(t).join(" "));
    if (fieldsAsWords.some((t) => t === phrase)) score += 60;
    else if (fieldsAsWords.some((t) => t.startsWith(phrase))) score += 30;
    else if (fieldsAsWords.some((t) => t.includes(phrase))) score += 15;
    if (tokens.every((t) => primary.includes(t))) score += 20;
    scored.push({ item, score, length: preferShorter ? all.length : 0, index });
  });

  return scored
    .sort((a, b) => b.score - a.score || a.length - b.length || a.index - b.index)
    .map((s) => s.item);
}
