import type { MetadataRoute } from "next";
import { toAbsoluteUrl } from "./site-metadata";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: toAbsoluteUrl("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: toAbsoluteUrl("/privacy"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: toAbsoluteUrl("/imprint"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
