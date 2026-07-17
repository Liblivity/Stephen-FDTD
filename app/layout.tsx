import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wavefront Studio — Interactive 2D FDTD",
  description: "Explore electric field, intensity, and phase as an optical wave interacts with a dielectric nanopillar.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
