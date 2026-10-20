import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { tokens } from "@hearth/design-tokens";
import "@hearth/design-tokens/tokens.css";
import "./globals.css";

// next/font self-hosts the faces; globals.css maps them onto the token names (--font-display / --font-body / --font-mono).
const display = Fraunces({ subsets: ["latin"], variable: "--nf-display", display: "swap", axes: ["opsz"] });
const body = Instrument_Sans({ subsets: ["latin"], variable: "--nf-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--nf-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Hearth | Simulated Alexa+ host",
  description:
    "A simulated Alexa+ host for the Hearth add-on: a real MCP client over Streamable HTTP, with the JSON-RPC traffic on show.",
};

export const viewport: Viewport = { themeColor: tokens.color.soot, colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
