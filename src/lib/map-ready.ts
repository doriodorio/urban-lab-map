import type * as maplibregl from "maplibre-gl";

/**
 * Run something as soon as the map's style can take it.
 *
 * Every effect that touches a source or a layer has to wait for the style,
 * and the obvious way to wait is wrong:
 *
 *     if (map.isStyleLoaded()) update();
 *     else map.once("load", update);
 *
 * `load` fires once in a map's life, and an effect that misses it waits for
 * an event that will never come again. Nothing throws; the work is simply
 * dropped, so the project perimeter, or a layer of items, is just missing
 * until something unrelated re-runs the effect - toggling its checkbox, say.
 * A bug that leaves no trace and looks like a flake is the worst kind to
 * leave in a tool students are using in the field.
 *
 * Missing `load` is easy, because `isStyleLoaded` is stricter than its name
 * suggests: it is false until the style document has parsed AND every source
 * it declares has finished loading. On a cold page the style's own tiles are
 * still arriving when React runs the effects, so the flag is false for
 * several of them, and by the time the last source settles `load` is long
 * past. Measured here: of seven effects on one page load, four caught a later
 * `styledata` and three waited forever.
 *
 * Nor is `styledata` enough on its own, which is what makes this worth a
 * shared helper rather than a line in each effect. A source finishing emits
 * `sourcedata`, not `styledata`, so the moment the flag finally flips may
 * carry no `styledata` with it at all. `idle` is the one event guaranteed to
 * arrive once everything has settled, so it is the backstop. Listen for all
 * of them, re-check the flag each time, and run on the first that is true.
 *
 * Returns a cleanup. Effects must call it, or a second style change will run
 * a stale closure over data React has already replaced.
 */
const SETTLE_EVENTS = ["styledata", "sourcedata", "idle", "load"] as const;

export function whenStyleReady(
  map: maplibregl.Map,
  run: () => void
): () => void {
  if (map.isStyleLoaded()) {
    run();
    return () => {};
  }

  let done = false;

  const detach = () => {
    for (const event of SETTLE_EVENTS) map.off(event, attempt);
  };

  const attempt = () => {
    if (done || !map.isStyleLoaded()) return;
    done = true;
    detach();
    run();
  };

  for (const event of SETTLE_EVENTS) map.on(event, attempt);

  return () => {
    done = true;
    detach();
  };
}
