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

/** Open this item where it was found. */
export function IconOnMap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s6.25-5.8 6.25-10.5a6.25 6.25 0 1 0-12.5 0C5.75 15.2 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.25" />
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
