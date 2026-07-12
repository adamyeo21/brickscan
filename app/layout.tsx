import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrickScan — Carousell → BrickLink deal finder",
  description: "Compare Carousell LEGO listings against BrickLink resale values",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
