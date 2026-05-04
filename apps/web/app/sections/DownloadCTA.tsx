"use client";

import { motion } from "framer-motion";
import { Download, Smartphone, ExternalLink } from "lucide-react";

const downloadOptions = [
  {
    label: "App Store",
    sublabel: "Coming Soon",
    href: "#",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.21-1.97 1.07-3.11-1.05.05-2.31.71-3.06 1.58-.67.78-1.26 2.02-1.1 3.13 1.18.09 2.38-.75 3.09-1.6" />
      </svg>
    ),
    disabled: true,
  },
  {
    label: "Google Play",
    sublabel: "Coming Soon",
    href: "#",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 20.5v-17c0-.83.67-1.5 1.5-1.5.33 0 .65.1.92.3l13.54 8.5c.55.34.72 1.07.38 1.62-.1.16-.22.3-.38.4L5.42 21.7c-.55.34-1.28.17-1.62-.38-.1-.16-.16-.35-.16-.54l.36-.28M17 18.25V5.75l4.9-3.08c.55-.34 1.28-.17 1.62.38.1.16.16.35.16.54v17.62c0 .83-.67 1.5-1.5 1.5-.33 0-.65-.1-.92-.3L17 18.25z" />
      </svg>
    ),
    disabled: true,
  },
  {
    label: "Expo Go",
    sublabel: "Try it now",
    href: "https://expo.dev/accounts/0xpankaj/projects/arena",
    icon: <ExternalLink className="w-6 h-6" />,
    disabled: false,
  },
  {
    label: "Seeker dApp Store",
    sublabel: "Coming Soon",
    href: "#",
    icon: <Smartphone className="w-6 h-6" />,
    disabled: true,
  },
];

export function DownloadCTA() {
  return (
    <section id="download" className="relative py-24 sm:py-32 px-4">
      <div className="max-w-4xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-elevated border border-border-accent mb-8">
            <Download className="w-4 h-4 text-accent" />
            <span className="text-sm text-text-secondary font-mono">
              Download the App
            </span>
          </div>

          <h2 className="font-heading font-bold text-3xl sm:text-4xl md:text-5xl mb-4">
            Start Trading With{" "}
            <span className="text-accent">AI Agents</span>
          </h2>
          <p className="text-text-secondary text-lg max-w-xl mx-auto mb-12">
            Download Agent Arena on your device. Hire agents, monitor trades,
            and earn from prediction markets — all from your pocket.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
            {downloadOptions.map((option, i) => (
              <motion.a
                key={option.label}
                href={option.disabled ? undefined : option.href}
                target={option.disabled ? undefined : "_blank"}
                rel={option.disabled ? undefined : "noopener noreferrer"}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className={
                  option.disabled
                    ? "flex items-center gap-4 p-4 rounded-xl bg-surface-elevated border border-border opacity-50 cursor-not-allowed"
                    : "flex items-center gap-4 p-4 rounded-xl bg-surface-elevated border border-border hover:border-accent/30 hover:shadow-[0_0_20px_rgba(249,115,22,0.1)] transition-all group"
                }
              >
                <div className="text-white">{option.icon}</div>
                <div className="text-left">
                  <div className="text-white font-semibold text-sm">
                    {option.label}
                  </div>
                  <div className="text-text-muted text-xs">{option.sublabel}</div>
                </div>
              </motion.a>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6 }}
            className="mt-8 text-text-muted text-sm"
          >
            Built with Expo & React Native. Solana Mobile Wallet Adapter
            integrated.
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}
