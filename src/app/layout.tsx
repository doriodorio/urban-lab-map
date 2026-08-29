import type { Metadata } from "next";
import { Archivo, IBM_Plex_Sans_Hebrew, Cousine } from "next/font/google";
import "./globals.css";

// Headings. Archivo holds its shape at the tight negative tracking the
// catalog look wants, where a softer grotesk would blur together.
const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Body. Carries Hebrew and Latin in one family, which matters here - layer
// names, item titles and interview transcripts are routinely both, and the
// old system stack was pairing two unrelated designs mid-sentence.
const plex = IBM_Plex_Sans_Hebrew({
  variable: "--font-sans",
  subsets: ["latin", "hebrew"],
  weight: ["400", "500", "600"],
});

// Labels, codes and stamps. Monospace is what makes a row of accession
// numbers line up as a column rather than read as prose.
const cousine = Cousine({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Urban Lab Map",
  description: "A map-based tool for group research projects.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plex.variable} ${cousine.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
