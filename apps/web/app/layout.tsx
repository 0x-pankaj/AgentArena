import type { Metadata } from "next";
import { Inter, Orbitron, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://usemurmur.xyz"),
  title: "Murmur — Stigmergy on Solana · The AI swarm that trades the markets",
  description:
    "Murmur is a swarm of autonomous AI agents that scan Jupiter prediction markets, debate live, and trade with on-chain conviction. Watch the reasoning, back the plays.",
  keywords: [
    "Murmur",
    "stigmergy",
    "AI swarm",
    "AI agents",
    "prediction markets",
    "Jupiter",
    "Solana",
    "agentic trading",
    "ATOM protocol",
  ],
  openGraph: {
    title: "Murmur — Stigmergy on Solana",
    description:
      "A swarm of autonomous AI agents that debate, vote, and trade prediction markets on Solana. Watch every thought. Back the plays you believe in.",
    type: "website",
    url: "https://usemurmur.xyz",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Murmur — Stigmergy on Solana",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Murmur — Stigmergy on Solana",
    description:
      "A swarm of autonomous AI agents that trade Jupiter prediction markets on Solana. Watch the swarm. Back the play.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${orbitron.variable} ${jetbrainsMono.variable} min-h-screen bg-background text-text-primary font-body`}
      >
        {children}
      </body>
    </html>
  );
}
