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
  title: "PSY Sampler — Production-Ready Realization Device",
  description: "Web-audio sampler with 36 features: velocity patterns, probability, MIDI, automation, stems, song mode, offline render. 301 tests. 15 shortcuts.",
  keywords: ["psytrance", "sampler", "web-audio", "groovebox", "music", "react", "midi", "daw"],
  authors: [{ name: "PSY Family" }],
  manifest: "/manifest.json",
  openGraph: {
    title: "PSY Sampler",
    description: "Web-audio sampler with 36 features: velocity patterns, probability, MIDI, automation, stems, song mode, offline render.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PSY Sampler",
    description: "Web-audio sampler with 36 features: velocity patterns, probability, MIDI, automation, stems, song mode, offline render.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PSY Sampler",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/logo.svg" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
