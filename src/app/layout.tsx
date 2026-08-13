import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PSY Sampler — Debug-First Realization Device",
  description: "Web-audio groovebox sampler with 16-step pattern editor, 3-bus mixer, presets, and live debug panel.",
  keywords: ["psytrance", "sampler", "web-audio", "groovebox", "music", "react"],
  authors: [{ name: "PSY Family" }],
  openGraph: {
    title: "PSY Sampler",
    description: "Web-audio groovebox sampler with 16-step pattern editor, 3-bus mixer, presets, and live debug panel.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PSY Sampler",
    description: "Web-audio groovebox sampler with 16-step pattern editor, 3-bus mixer, presets, and live debug panel.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
