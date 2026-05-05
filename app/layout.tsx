import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Showroom Display",
  description: "Cabinet showroom display + admin",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
