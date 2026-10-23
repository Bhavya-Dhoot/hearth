import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, JetBrains_Mono } from "next/font/google";
import { tokens } from "@hearth/design-tokens";
import "@hearth/design-tokens/tokens.css";
import "./globals.css";

// next/font self-hosts the faces; globals.css maps them onto the token names (--font-display / --font-body / --font-mono).
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--nf-display", display: "swap" });
const body = Geist({ subsets: ["latin"], variable: "--nf-body", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--nf-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Hearth | Simulated Alexa+ host",
  description:
    "A simulated Alexa+ host for the Hearth add-on: a real MCP client over Streamable HTTP, with the JSON-RPC traffic on show.",
};

export const viewport: Viewport = { themeColor: tokens.color.ink, colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
