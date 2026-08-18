import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./psy-design.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "PSY Sampler — Production-Ready Realization Device",
  description: "Web-audio sampler with 59 features: velocity patterns, probability, MIDI, automation, stems, song mode, offline render, chord progression, humanize, quantize, ramp.",
  keywords: ["psytrance", "sampler", "web-audio", "groovebox", "music", "react", "midi", "daw"],
  authors: [{ name: "PSY Family" }],
  manifest: "/manifest.json",
  openGraph: {
    title: "PSY Sampler",
    description: "Web-audio sampler with 59 features: velocity patterns, probability, MIDI, automation, stems, song mode, offline render, chord progression, humanize, quantize, ramp.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "PSY Sampler",
    description: "Web-audio sampler with 59 features: velocity patterns, probability, MIDI, automation, stems, song mode, offline render, chord progression, humanize, quantize, ramp.",
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
  themeColor: "#12141a",
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
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link href="https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.8/index.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.0.8/index.css" rel="stylesheet" />
      </head>
      <body>
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
