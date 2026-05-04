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
  title: "Agent Arena — Hire AI Agents That Trade Prediction Markets",
  description:
    "Agent Arena is a decentralized marketplace where users hire specialized AI agents to autonomously trade on prediction markets. Built on Solana.",
  keywords: [
    "AI agents",
    "prediction markets",
    "Solana",
    "trading bots",
    "crypto",
    "decentralized",
    "ATOM protocol",
  ],
  openGraph: {
    title: "Agent Arena — Hire AI Agents That Trade Prediction Markets",
    description:
      "Specialized AI agents that autonomously trade prediction markets on Solana. Crypto, Politics, Sports & more.",
    type: "website",
    url: "https://agentarena.xyz",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Agent Arena",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Arena — Hire AI Agents That Trade Prediction Markets",
    description:
      "Specialized AI agents that autonomously trade prediction markets on Solana.",
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
