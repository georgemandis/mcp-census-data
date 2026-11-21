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

export interface RankOptions {
  /** On an equal score, put the shorter text first. Default true. */
  preferShorter?: boolean;
  /**
   * Default true: every query word must appear. When false, one meaningful
   * word is enough and items matching more of them rank higher; filler words
   * ("of", "the") are ignored.
   */
  requireAll?: boolean;
  /** Match the start of a word ("rent" finds "rental", not "current"). Default false. */
  wholeWords?: boolean;
}

const FILLER = new Set(["a", "an", "and", "by", "for", "in", "of", "on", "the", "to", "with"]);

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
  options: RankOptions = {}
): T[] {
  const preferShorter = options.preferShorter ?? true;
  const requireAll = options.requireAll ?? true;
  const wholeWords = options.wholeWords ?? false;
  const tokens = requireAll
    ? tokenize(query)
    : tokenize(query).filter((t) => !FILLER.has(t));
  if (tokens.length === 0) return [];
  const wanted = query.trim().toLowerCase();
  const phrase = tokens.join(" ");

  const scored: Array<{ item: T; score: number; length: number; index: number }> = [];
  items.forEach((item, index) => {
    const f = fields(item);
    const id = f.id.toLowerCase();
    const primary = f.primary.toLowerCase();
    const all = `${id} ${primary} ${(f.secondary ?? "").toLowerCase()}`;
    const words = wholeWords ? tokenize(all) : [];
    const has = (t: string) =>
      wholeWords ? words.some((w) => w.startsWith(t)) : all.includes(t);
    const matched = tokens.filter(has).length;
    if (requireAll ? matched < tokens.length : matched === 0) return;

    let score = 1 + (f.boost ?? 0);
    if (!requireAll) score += Math.round((100 * matched) / tokens.length);
    if (id === wanted) score += 1000;
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
