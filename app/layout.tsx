import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steam Family Share Planner",
  description: "Score who's the best add to your Steam Family by new shareable games and value.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
