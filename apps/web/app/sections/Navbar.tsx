"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Zap, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { label: "Agents", href: "#agents" },
  { label: "Swarm", href: "#swarm" },
  { label: "On-Chain", href: "#onchain" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "GitHub", href: "https://github.com/0x-pankaj/AgentArena", external: true },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-surface/80 backdrop-blur-xl border-b border-border"
          : "bg-transparent"
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="#" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center group-hover:shadow-[0_0_20px_rgba(249,115,22,0.4)] transition-shadow">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="font-heading font-bold text-lg tracking-wide text-white">
              AGENT ARENA
            </span>
          </a>

          {/* Desktop Links */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                className="text-sm text-text-secondary hover:text-white transition-colors font-medium"
              >
                {link.label}
              </a>
            ))}
            <a
              href="#download"
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent-dark transition-colors shadow-[0_0_20px_rgba(249,115,22,0.25)]"
            >
              Get the App
            </a>
          </div>

          {/* Mobile Toggle */}
          <button
            className="md:hidden text-white"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-surface/95 backdrop-blur-xl border-b border-border overflow-hidden"
          >
            <div className="px-4 py-4 flex flex-col gap-4">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noopener noreferrer" : undefined}
                  className="text-text-secondary hover:text-white transition-colors font-medium"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <a
                href="#download"
                className="px-4 py-2 rounded-lg bg-accent text-white text-center font-semibold hover:bg-accent-dark transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                Get the App
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
