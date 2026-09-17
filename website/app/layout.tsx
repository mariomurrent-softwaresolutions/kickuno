import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, DM_Mono } from "next/font/google";
import "./globals.css";
import { CookieBanner } from "./CookieBanner";
import { SITE_NAME, buildMetadata } from "./site-metadata";

const sans = Barlow({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const heading = Barlow_Condensed({ variable: "--font-heading", subsets: ["latin"], weight: ["500", "600", "700"] });
const mono = DM_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = buildMetadata({
  title: SITE_NAME,
  path: "/",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className={`${sans.variable} ${heading.variable} ${mono.variable}`}>
        {children}
        <CookieBanner />
      </body>
    </html>
  );
}
