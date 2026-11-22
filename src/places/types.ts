/**
 * Overture's place types form a tree, written as paths:
 *   "shopping > food_and_beverage_store > grocery_store"
 *
 * This turns what someone asked for ("grocery stores") into one node of
 * that tree. The caller is a model that can ask again, so the rule is: count
 * a type only when it is clearly the one meant; otherwise count nothing and
 * return candidates. A wrong count is worse than a question.
 */

export interface TypeNode {
  /** Full path, levels joined by " > ". */
  path: string;
  /** The last level, for example "grocery_store". */
  name: string;
  /** Places of this type and everything beneath it, nationally. */
  n: number;
}

export type TypeMatch = TypeNode | { candidates: TypeNode[] };

const SEP = " > ";
const MAX_CANDIDATES = 8;
/** When several types share a name, one must be this many times larger to be taken. */
const DOMINANT = 10;

const FILLER = new Set(["a", "an", "and", "of", "or", "the", "near", "nearby", "local", "me", "here"]);
// Words that say little about what a place is. A type may be meant without
// them ("doctors" for doctors_office), but they never identify a type alone.
const GENERIC = new Set([
  "service", "store", "shop", "place", "center", "centre", "facility", "organization", "establishment",
  "office", "clinic",
]);

/** A plural as its singular, with "-ie" and "-y" endings made one: movies, movie; libraries, library. */
export function fold(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -1);
  else if (/(ch|sh|ss|x)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith("ie")) w = w.slice(0, -2) + "y";
  return w;
}

/** Lower-case words without accents or filler, each folded. */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w))
    .map(fold);
}

// Everyday names for types whose Overture name shares no word with them.
// Values are Overture type names; each is used only if that type exists.
const EVERYDAY_NAMES: Record<string, string> = {
  church: "christian_place_of_worship",
  mosque: "muslim_place_of_worship",
  synagogue: "jewish_place_of_worship",
  dentist: "dental_clinic",
  chiropractor: "chiropractic",
  optometrist: "optometry",
  vet: "veterinarian",
  lawyer: "attorney_or_law_firm",
  attorney: "attorney_or_law_firm",
  daycare: "child_care_and_day_care",
  "day care": "child_care_and_day_care",
  childcare: "child_care_and_day_care",
  "child care": "child_care_and_day_care",
  tutor: "tutoring_service",
  tutoring: "tutoring_service",
  supermarket: "grocery_store",
  "thrift store": "second_hand_store",
  "thrift shop": "second_hand_store",
  "food pantry": "food_bank",
  college: "college_university",
  university: "college_university",
  movie: "movie_theater",
  cinema: "movie_theater",
  nightclub: "dance_club",
  pinball: "arcade",
};
const EVERYDAY = new Map(Object.entries(EVERYDAY_NAMES).map(([k, v]) => [words(k).join(" "), v]));

/** True when `path` is `node` itself or lies beneath it in the tree. */
export function isUnder(path: string, node: string): boolean {
  return path === node || path.startsWith(node + SEP);
}

const related = (a: string, b: string) => isUnder(a, b) || isUnder(b, a);
const depth = (path: string) => path.split(SEP).length;
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((w) => b.has(w));
const specific = (ws: Iterable<string>) => new Set([...ws].filter((w) => !GENERIC.has(w)));

// A rough stem, used only to suggest candidates: "therapists" and
// "psychotherapy" share "therap".
function stem(word: string): string {
  const s = word.replace(/(ists|ist|ians|ian|ors|or|ers|er|ics|ic|ing|ies|es|s|y)$/, "");
  return s.length >= 4 ? s : word;
}
function alike(a: string, b: string): boolean {
  const sa = stem(a);
  const sb = stem(b);
  if (sa.length < 5 || sb.length < 5) return false;
  if (sa.startsWith(sb) || sb.startsWith(sa)) return true;
  // A long stem inside a longer word: "therap" in "psychotherap".
  return (sa.length >= 6 && sb.includes(sa)) || (sb.length >= 6 && sa.includes(sb));
}

const normal = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s*>\s*/g, SEP);

export function matchType(asked: string, nodes: TypeNode[]): TypeMatch {
  const text = normal(asked);
  if (!text) return { candidates: [] };

  // 1. A full path is taken as given.
  const byPath = text.includes(SEP) ? nodes.find((n) => n.path === text) : undefined;
  if (byPath) return byPath;

  // Of several types, the one to take: the only one, or one far larger than the rest.
  const clear = (found: TypeNode[]): TypeNode | undefined => {
    const sorted = [...found].sort((a, b) => b.n - a.n);
    if (sorted.length === 1 || (sorted.length > 1 && sorted[0].n >= sorted[1].n * DOMINANT)) return sorted[0];
    return undefined;
  };
  const named = (name: string) => clear(nodes.filter((n) => n.name === name));

  // 2. A type's own name, as typed.
  const asName = text.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const exact = named(asName);
  if (exact) return exact;

  const want = new Set(words(text));
  if (want.size === 0) return { candidates: [] };

  // 3. An everyday name ("churches", "dentists").
  const everyday = EVERYDAY.get([...want].join(" "));
  const known = everyday ? named(everyday) : undefined;
  if (known) return known;

  const wordsOf = new Map(nodes.map((n) => [n, new Set(words(n.name))]));

  // 4. The same words as a type's name, whatever the order or number ("local parks").
  const sameWords = clear(nodes.filter((n) => sameSet(wordsOf.get(n)!, want)));
  if (sameWords) return sameWords;

  // 5. The type's name without its say-little words ("doctors" for
  //    doctors_office, "grocery" for grocery_store), but only when every
  //    other type containing these words belongs to the same family.
  const wantSpecific = specific(want);
  if (wantSpecific.size > 0) {
    const fits = nodes
      .filter((n) => sameSet(specific(wordsOf.get(n)!), wantSpecific))
      .sort((a, b) => depth(a.path) - depth(b.path) || b.n - a.n);
    const pick = fits[0];
    if (pick) {
      const sharing = nodes.filter((n) => [...wantSpecific].every((w) => wordsOf.get(n)!.has(w)));
      if (sharing.every((n) => related(n.path, pick.path))) return pick;
    }
  }

  // Otherwise: nothing is counted. Offer the types that share words with
  // what was asked, or nearly do.
  const scored = nodes
    .map((node) => {
      const have = wordsOf.get(node)!;
      let score = 0;
      for (const w of want) {
        const heavy = GENERIC.has(w) ? 0.3 : 1;
        if (have.has(w)) score += heavy;
        else if ([...have].some((h) => alike(w, h))) score += heavy * 0.5;
      }
      return { node, score, extra: have.size };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.node.n - a.node.n || a.extra - b.extra);

  return { candidates: scored.slice(0, MAX_CANDIDATES).map((s) => s.node) };
}
