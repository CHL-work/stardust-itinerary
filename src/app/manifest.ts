import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stardust Itinerary · 星塵遠征軍",
    short_name: "Stardust",
    description: "A private group trip planner for a small expedition party.",
    start_url: "/",
    display: "standalone",
    background_color: "#171225",
    theme_color: "#171225",
    icons: [
      {
        src: "/icons/stardust-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/stardust-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
