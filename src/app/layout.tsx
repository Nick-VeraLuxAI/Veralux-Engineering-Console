import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VeraLux Engineering Console",
  description: "Internal operator console for AI-assisted engineering workflows",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
