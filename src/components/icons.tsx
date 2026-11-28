/**
 * The app's icons.
 *
 * Drawn inline rather than loaded, for one reason that decides everything
 * else: `currentColor`. The whole palette is two tokens that swap in dark
 * mode, and an icon drawn here inherits the colour of the button it sits in,
 * so it follows them for free. A `.svg` file or an icon font would need a
 * second copy of every glyph.
 *
 * One grid (24), one weight (1.5), stroked and never filled - the interface
 * is thin rules and quiet type, and solid icons read as though they were
 * pasted in from somewhere else.
 *
 * Each is `aria-hidden`: an icon is never the accessible name. The button
 * carries that, in `aria-label`, along with a `title` so the words are one
 * hover away for anyone who has not met the glyph before.
 */

type IconProps = { className?: string };

function Svg({
  className = "size-4",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/**
 * Join this card to another.
 *
 * Two nodes and the line between them - the same mark the board draws for a
 * link, so the button looks like what it makes.
 */
export function IconConnect(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M7.9 16.1 16.1 7.9" />
    </Svg>
  );
}

/**
 * A pin: a point on the map.
 *
 * One drawing behind every button that means "a place" - opening an item
 * where it was found, and dropping a new point. Shared rather than copied so
 * the two cannot drift into looking like different ideas.
 */
function Pin() {
  return (
    <>
      <path d="M12 21s6.25-5.8 6.25-10.5a6.25 6.25 0 1 0-12.5 0C5.75 15.2 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.25" />
    </>
  );
}

/** Open this item where it was found. */
export function IconOnMap(props: IconProps) {
  return (
    <Svg {...props}>
      <Pin />
    </Svg>
  );
}

/** Put a point on the map by clicking it. */
export function IconPoint(props: IconProps) {
  return (
    <Svg {...props}>
      <Pin />
    </Svg>
  );
}

/**
 * Here: ask the device where it is.
 *
 * A crosshair, which is what every map on a phone uses for the same thing -
 * the one mark in this set that a student arrives already knowing.
 */
export function IconHere(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21" />
    </Svg>
  );
}

/**
 * No place: a source that was not found anywhere.
 *
 * The same pin, struck through. An article about a street was not written on
 * it, and this is the answer that says so - so it is drawn as the opposite
 * of the pin rather than as an unrelated mark.
 */
export function IconNoPlace(props: IconProps) {
  return (
    <Svg {...props}>
      <Pin />
      <path d="M4.5 20 20 4.5" />
    </Svg>
  );
}

/** Draw a route: a line with its points. */
export function IconLine(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5.8 16.8 4-7 4.4 3.4 3.9-6.6" />
      <circle cx="4.75" cy="18.6" r="1.75" />
      <circle cx="19.25" cy="5.4" r="1.75" />
    </Svg>
  );
}

/** Draw an area: a closed shape with its corners. */
export function IconRegion(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.2 19.3 9.6 16.5 18.4h-9L4.7 9.6Z" />
      <circle cx="12" cy="4.2" r="1.5" fill="var(--card)" />
      <circle cx="19.3" cy="9.6" r="1.5" fill="var(--card)" />
      <circle cx="4.7" cy="9.6" r="1.5" fill="var(--card)" />
    </Svg>
  );
}

/**
 * Take the card off the board.
 *
 * A card with the way out open, not a bin: this removes it from the
 * arrangement and leaves the item in the project. The one thing this mark
 * must not suggest is deletion.
 */
export function IconOffBoard(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h7" />
      <path d="M19 12h-7.5" />
      <path d="m16 9 3 3-3 3" />
    </Svg>
  );
}
