import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3-A-Day Content Engine",
  description: "Generate 3 TikTok video ideas per day and manage your content pipeline",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
