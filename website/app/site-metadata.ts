import type { Metadata } from "next";

export const SITE_NAME = "Kickuno";
export const SITE_DESCRIPTION =
  "Zusagen, faire Teams, Ergebnisse und Statistiken für eure Fußballrunde – alles an einem Ort, statt verstreut in der WhatsApp-Gruppe.";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.SITE_URL ??
  "https://kickuno.meecode.at"
).replace(/\/+$/, "");

function normalizePath(path: string): string {
  if (path === "/") return "/";
  return path.endsWith("/") ? path : `${path}/`;
}

export function toAbsoluteUrl(path: string): string {
  return new URL(normalizePath(path), `${SITE_URL}/`).toString();
}

export function buildMetadata({
  title,
  description = SITE_DESCRIPTION,
  path,
}: {
  title: string;
  description?: string;
  path: string;
}): Metadata {
  const canonicalUrl = toAbsoluteUrl(path);

  return {
    title,
    description,
    metadataBase: new URL(SITE_URL),
    applicationName: SITE_NAME,
    alternates: { canonical: canonicalUrl },
    robots: "index,follow,max-image-preview:large",
    icons: {
      icon: "/kickuno-icon.png",
      shortcut: "/favicon.png",
    },
    openGraph: {
      type: "website",
      url: canonicalUrl,
      siteName: SITE_NAME,
      title,
      description,
      images: ["/og.png"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}
