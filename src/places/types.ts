/**
 * Overture's place types form a tree, written as paths:
 *   "shopping > food_and_beverage_store > grocery_store"
 *
 * This turns what someone asked for ("grocery stores") into one node of
 * that tree. The caller is a model that can ask again, so the matching is
 * deliberately simple and its result is always shown: when it is not clear
 * which node is meant, it returns candidates and counts nothing.
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
/** How alike the words and a type's name must be to count as a match. */
const MATCH_SCORE = 0.6;
/** How far the best must lead the next unrelated type. */
const CLEAR_LEAD = 1.5;

const FILLER = new Set(["a", "an", "and", "of", "or", "the", "near", "nearby", "local"]);
// Words that say little about what a place is; they count for less.
const GENERIC = new Set([
  "service", "store", "shop", "place", "center", "centre", "facility", "organization", "establishment",
  "office",
]);

// Everyday names for types whose Overture name shares no word with them.
// Keys are folded words; values are Overture type names. Each is used only
// if that type exists in the data.
const EVERYDAY: Record<string, string> = {
  church: "christian_place_of_worship",
  mosque: "muslim_place_of_worship",
  synagogue: "jewish_place_of_worship",
  dentist: "dental_clinic",
  daycare: "child_care_and_day_care",
  "day care": "child_care_and_day_care",
  childcare: "child_care_and_day_care",
  supermarket: "grocery_store",
  "thrift store": "second_hand_store",
  "thrift shop": "second_hand_store",
  "food pantry": "food_bank",
  college: "college_university",
  university: "college_university",
  pinball: "arcade",
};

/** When several types share a name, one must be this many times larger to be taken. */
const DOMINANT = 10;

/** A plural as its singular: libraries, churches, parks. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(ch|sh|ss|x)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** One form for a word and its plural or "-ing" form: tutors, tutoring, tutor. */
export function fold(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  return singular(w);
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w))
    .map(fold);

const weight = (w: string) => (GENERIC.has(w) ? 0.3 : 1);
const total = (ws: Iterable<string>) => [...ws].reduce((s, w) => s + weight(w), 0);

/** True when `path` is `node` itself or lies beneath it in the tree. */
export function isUnder(path: string, node: string): boolean {
  return path === node || path.startsWith(node + SEP);
}

const related = (a: string, b: string) => isUnder(a, b) || isUnder(b, a);
const depth = (path: string) => path.split(SEP).length;

/** 1 when the words asked for are exactly the type's name; less as they differ. */
function likeness(asked: Set<string>, name: Set<string>): number {
  const shared = [...asked].filter((w) => name.has(w));
  if (shared.length === 0) return 0;
  const s = total(shared);
  return (s * s) / (total(asked) * total(name));
}

const normal = (text: string) => text.trim().toLowerCase().replace(/\s*>\s*/g, SEP);

export function matchType(asked: string, nodes: TypeNode[]): TypeMatch {
  const text = normal(asked);
  if (!text) return { candidates: [] };

  // A full path is taken as given. (A bare word is a name, handled next.)
  const byPath = text.includes(SEP) ? nodes.find((n) => n.path === text) : undefined;
  if (byPath) return byPath;

  // The one type with this name; or, when several share it, one far larger than the rest.
  const named = (name: string): TypeNode | undefined => {
    const found = nodes.filter((n) => n.name === name).sort((a, b) => b.n - a.n);
    if (found.length === 1 || (found.length > 1 && found[0].n >= found[1].n * DOMINANT)) return found[0];
    return undefined;
  };

  // A type's own name, as typed or in the plural ("parks" is park, not parking).
  const asName = text.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const exact = named(asName) ?? named(singular(asName));
  if (exact) return exact;

  const askedWords = words(text);
  if (askedWords.length === 0) return { candidates: [] };
  const everyday = EVERYDAY[askedWords.join(" ")];
  const known = everyday ? named(everyday) : undefined;
  if (known) return known;

  const want = new Set(askedWords);

  const scored = nodes
    .map((node) => {
      const levels = node.path.split(SEP);
      const own = likeness(want, new Set(words(node.name)));
      // A word found only higher up the path ("government") still earns a mention.
      const above = likeness(want, new Set(levels.slice(0, -1).flatMap(words)));
      return { node, own, hint: own > 0 ? own : above * 0.1 };
    })
    .filter((s) => s.hint > 0)
    .sort((a, b) => b.hint - a.hint || depth(a.node.path) - depth(b.node.path) || b.node.n - a.node.n);

  if (scored.length === 0) return { candidates: [] };

  const best = scored[0];
  if (best.own >= MATCH_SCORE) {
    const rival = scored.find((s) => s !== best && !related(s.node.path, best.node.path));
    if (!rival || best.own >= rival.own * CLEAR_LEAD) return best.node;
  }

  const candidates = scored
    .slice()
    .sort((a, b) => b.hint - a.hint || b.node.n - a.node.n)
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.node);
  return { candidates };
}
