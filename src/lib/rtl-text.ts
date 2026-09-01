import * as maplibregl from "maplibre-gl";

/**
 * Loads the right-to-left text plugin, without which Hebrew and Arabic labels
 * render in logical order - which reads as backwards on screen.
 *
 * Only vector styles need this. Raster tiles arrive as pictures with the text
 * already drawn correctly by the tile server; vector styles ship the strings
 * and shape them in the browser, so the shaping has to happen here. It is
 * therefore not optional anywhere a vector style can be chosen - including the
 * published viewer, where the readers are the ones who most need Hebrew to
 * read the right way round.
 *
 * Self-hosted rather than loaded from a CDN: the plugin is fetched by the
 * MapLibre worker, and a Hebrew-first cohort shouldn't have legible labels
 * depend on a third-party host staying up. Loaded eagerly, not lazily -
 * `lazy: true` defers until RTL text appears, which means the first Hebrew
 * labels render wrong and then correct themselves.
 */
export function ensureRtlTextSupport() {
  if (maplibregl.getRTLTextPluginStatus() !== "unavailable") return;
  maplibregl.setRTLTextPlugin("/mapbox-gl-rtl-text.js", false).catch(() => {
    // Labels fall back to unshaped RTL rather than the map failing to load.
  });
}
