"use client";

import { useCallback, useState } from "react";

/**
 * Where the device says it is, and whether that is worth calling a
 * measurement.
 *
 * This tool calls itself a field archive of the city made on foot, and until
 * now the one thing a person standing in the street could not do was say "it
 * is here". They had to find the spot on a map by eye and tap it - which is
 * recorded as 'surveyed', a claim of unknown precision, even when they are
 * standing on it. For a photograph the camera answers. For a sound, a smell
 * or the feel of a wall there is no file to read, and those are exactly the
 * things you can only record by being there.
 *
 * So the device is read instead, and the reading is honest about itself.
 *
 * The accuracy check is the whole point. `getCurrentPosition` answers
 * whatever it can - a satellite fix outdoors, a guess from nearby wifi
 * indoors, or the city the network thinks you are in - and reports all three
 * the same way apart from `coords.accuracy`, a radius in metres. A 1200-metre
 * "fix" written down as a measurement is worse than no button at all: it
 * would put the project's most confident mark on a coordinate nobody
 * measured. Past the threshold the position is still offered, because a
 * rough centre is a useful place to start from, but it arrives as an
 * ordinary hand-placed point and the form asks what it means as usual.
 *
 * 40 metres is the line. A satellite fix outdoors is commonly 5-20m, and a
 * street is narrower than 40m, so a reading inside it puts you on the right
 * side of the road; wifi positioning indoors is usually well outside it.
 */
export const MEASURED_WITHIN_METRES = 40;

export type Fix = {
  coordinates: [number, number];
  /** Radius in metres the device claims, rounded for display. */
  accuracy: number;
  /** True when it is tight enough to be recorded as a measurement. */
  measured: boolean;
};

type State =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "failed"; message: string };

/**
 * Turns the browser's error codes into something a student can act on.
 *
 * The three cases need three different things from the person and only one
 * of them is helped by pressing the button again, so they are not collapsed
 * into "could not get your location".
 */
function describe(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "This site is not allowed to use your location. Allow it in the browser's address bar, then try again.";
    case error.POSITION_UNAVAILABLE:
      return "Your device could not get a position. Outdoors, with a clear view of the sky, usually fixes this.";
    case error.TIMEOUT:
      return "Your device took too long to answer. Try again in a moment.";
    default:
      return "Your device could not report a position.";
  }
}

export function useHere(onFix: (fix: Fix) => void) {
  const [state, setState] = useState<State>({ status: "idle" });

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({
        status: "failed",
        message: "This browser cannot report a location.",
      });
      return;
    }

    setState({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;
        setState({ status: "idle" });
        onFix({
          coordinates: [longitude, latitude],
          accuracy: Math.round(accuracy),
          measured: accuracy <= MEASURED_WITHIN_METRES,
        });
      },
      (error) => setState({ status: "failed", message: describe(error) }),
      {
        // Ask for the satellite fix rather than the quick network guess. It
        // costs battery and seconds, and it is the difference between a
        // measurement and a rumour.
        enableHighAccuracy: true,
        timeout: 15000,
        // Never a remembered position. Someone who has walked two streets
        // since the last reading would be filing the previous corner.
        maximumAge: 0,
      }
    );
  }, [onFix]);

  return {
    locate,
    locating: state.status === "locating",
    error: state.status === "failed" ? state.message : null,
    clearError: () => setState({ status: "idle" }),
  };
}
