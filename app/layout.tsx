import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wavefront Studio — Interactive 2D FDTD",
  description: "Explore an 850 nm wave interacting with a dielectric nanopillar in a real-time browser simulation.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
