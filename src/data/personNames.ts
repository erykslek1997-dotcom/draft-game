/**
 * 2026-10-28 (the user, after the position review: "został Henderson i Dunleavy, ale dlatego że
 * stary z ojcem jest wymieszany"): two different people who share a name were one player in the
 * pool — the span ids keep them apart (BBRef ids `dunlemi01` / `dunlemi02`), the name did not. So
 * the game treated them as one man: you couldn't draft both, the neighbouring-window blends mixed
 * a 1980 guard into a 2005 wing, and the bio lookup gave both one height (Larry Johnson's 6'3" is
 * the same bug in the bio file, see `scripts/buildHeightLookup.ts`). Seven pairs in the pool.
 *
 * The better-known one keeps the plain name; the other gets the name the sport already uses for
 * him (Sr., a middle initial) or, where there is none, his school. Applied to the pool at load
 * (`draftPool.ts`) and to the name resolver's pool keys (`sourceNameResolver.ts`), which also
 * files each renamed player under the plain name's canonical form, so a source row that says
 * "Mike Dunleavy" in 1980 still finds the father.
 */
export const PERSON_NAME_BY_ID_PREFIX: Readonly<Record<string, string>> = {
  dunlemi01: 'Mike Dunleavy Sr.', // 1976-89 guard; the son (dunlemi02, 2002-16) keeps the name
  hendege01: 'Gerald Henderson Sr.', // 1979-91 guard; the son (hendege02, 2009-17)
  paxsoji01: 'Jim Paxson Sr.', // 1956-58, father of Jim (paxsoji02, 1979-90) and John
  johnsed03: 'Eddie A. Johnson', // 1981-99 Illinois forward; "Fast" Eddie Johnson (johnsed02, 1977-87) keeps the name
  johnsge03: 'George L. Johnson', // 1978-86 St. John's forward; George T. Johnson (johnsge02, 1972-86 centre) keeps the name
  jonesch02: 'Charles Jones (Louisville)', // 1984-88; Charles Jones of Albany State (jonesch01, 1983-98) keeps the name
  willire02: 'Reggie Williams (VMI)', // 2009-16; Reggie Williams of Georgetown (willire01, 1987-97) keeps the name
};

/** The span id's person part: `dunlemi01-1979-1980` -> `dunlemi01`. */
export function personIdOf(spanId: string): string {
  return spanId.split('-')[0];
}

/** The pool name for a span: the person's own name where his plain one is shared. */
export function personNameFor(spanId: string, playerName: string): string {
  return PERSON_NAME_BY_ID_PREFIX[personIdOf(spanId)] ?? playerName;
}
