import { useEffect, useState } from "react";
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

/**
 * The map, once it exists, as a value a render can depend on.
 *
 * A ref is not a dependency. A hook that reads `mapRef.current` in an effect
 * and gives up when it is null is betting that the map was created by an
 * earlier effect - which holds only while its call sits below the one that
 * builds the map, in the same component. Move it up a few lines, or call it
 * from a second component that happens to be ordered differently, and the
 * effect runs once against null and is never scheduled again, because a ref
 * changing re-renders nothing. The overlay then never appears and there is
 * nothing in the console to say why. That is exactly how the unplaced
 * sources went missing from the public viewer while working in the editor:
 * the same hook, the same data, called twelve lines higher up.
 *
 * So the ref is watched until it is filled and the map is handed back as
 * state, which does re-run the effects that depend on it. The watch costs a
 * handful of frames once per mount and ends the moment the map appears.
 */
export function useMapInstance(mapRef: {
  current: maplibregl.Map | null;
}): maplibregl.Map | null {
  const [map, setMap] = useState<maplibregl.Map | null>(mapRef.current);

  useEffect(() => {
    if (mapRef.current) {
      setMap(mapRef.current);
      return;
    }

    let frame = requestAnimationFrame(function look() {
      if (mapRef.current) setMap(mapRef.current);
      else frame = requestAnimationFrame(look);
    });
    return () => cancelAnimationFrame(frame);
  }, [mapRef]);

  return map;
}
