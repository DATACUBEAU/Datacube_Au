import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DataCube AU",
    short_name: "DataCube AU",
    description: "Datacube AU is an AI study platform by Zahed Investment Ltd (RC 8127949).",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1C1917",
    theme_color: "#3F51B5",
    icons: [
      {
        src: "/icon.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["productivity", "education"],
    screenshots: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        label: "DataCube AU Dashboard"
      }
    ]
  };
}
