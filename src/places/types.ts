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
]);

/** One form for a word and its plural or "-ing" form: tutors, tutoring, tutor. */
export function fold(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (/(ch|sh|ss|x)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
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

  // An exact path or an exact type name is taken as given.
  const byPath = nodes.find((n) => n.path === text);
  if (byPath) return byPath;
  const asName = text.replace(/[^a-z0-9]+/g, "_");
  const byName = nodes.filter((n) => n.name === asName);
  if (byName.length === 1) return byName[0];

  const want = new Set(words(text));
  if (want.size === 0) return { candidates: [] };

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
