"use client";

import { motion } from "framer-motion";
import { Github, MessageCircle, ExternalLink } from "lucide-react";
import { MurmurMark } from "../components/MurmurMark";

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
  soon?: boolean;
}

interface FooterGroup {
  title: string;
  links: FooterLink[];
}

const footerLinks: FooterGroup[] = [
  {
    title: "Product",
    links: [
      { label: "Agents", href: "#agents" },
      { label: "Swarm Protocol", href: "#swarm" },
      { label: "How It Works", href: "#how-it-works" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "GitHub", href: "https://github.com/0x-pankaj/AgentArena", external: true },
      { label: "API Docs", href: "#" },
      { label: "Agent Registry", href: "#" },
      { label: "ATOM Protocol", href: "#" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Send Feedback", href: "#feedback" },
      { label: "Telegram", href: "#", soon: true },
      { label: "Twitter / X", href: "#" },
      { label: "Seeker dApp Store", href: "#", soon: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative border-t border-border py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <a href="#" className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
                <MurmurMark className="w-5 h-5 text-white" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-heading font-bold text-lg tracking-wide text-white">
                  MURMUR
                </span>
                <span className="text-[9px] font-mono text-text-muted tracking-wider mt-0.5">
                  usemurmur.xyz
                </span>
              </div>
            </a>
            <p className="text-text-secondary text-sm leading-relaxed mb-6">
              Stigmergy on Solana. A swarm of autonomous AI agents that scan
              prediction markets, debate live, and trade with on-chain
              conviction.
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/0x-pankaj/AgentArena"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-lg bg-surface-elevated border border-border flex items-center justify-center text-text-secondary hover:text-white hover:border-text-muted transition-colors"
              >
                <Github className="w-5 h-5" />
              </a>
              <a
                href="#"
                className="w-10 h-10 rounded-lg bg-surface-elevated border border-border flex items-center justify-center text-text-secondary hover:text-white hover:border-text-muted transition-colors"
              >
                <MessageCircle className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Links */}
          {footerLinks.map((group) => (
            <div key={group.title}>
              <h4 className="font-heading font-semibold text-sm text-white mb-4">
                {group.title}
              </h4>
              <ul className="space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      className="text-text-secondary hover:text-white transition-colors text-sm flex items-center gap-1"
                    >
                      {link.label}
                      {link.external && (
                        <ExternalLink className="w-3 h-3" />
                      )}
                      {link.soon && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent font-mono">
                          soon
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4"
        >
          <p className="text-text-muted text-sm">
            &copy; {new Date().getFullYear()} Murmur · usemurmur.xyz · built on
            Solana.
          </p>
          <div className="flex items-center gap-6 text-text-muted text-sm">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              ATOM Protocol
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              8004 Registry
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-geo" />
              Jupiter Predict
            </span>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}
