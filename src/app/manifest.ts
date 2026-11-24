import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DataCube AU",
    short_name: "DataCube AU",
    description: "DataCube AU is a native Android document and study assistant by Zahed Investment Ltd (RC 8127949).",
    start_url: "/download",
    display: "browser",
    orientation: "portrait",
    background_color: "#1C1917",
    theme_color: "#3F51B5",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    categories: ["productivity", "education"],
    screenshots: []
  };
}
