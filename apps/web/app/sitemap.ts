import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const SITE = "https://usemurmur.xyz";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const sections = [
    "",
    "#agents",
    "#swarm",
    "#how-it-works",
    "#onchain",
    "#download",
    "#feedback",
  ];
  return sections.map((slug) => ({
    url: `${SITE}/${slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: slug === "" ? 1 : 0.7,
  }));
}
