"use client";

import { motion } from "framer-motion";
import { ArrowRight, Github, Download } from "lucide-react";
import { TypewriterText } from "../components/TypewriterText";

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div className="max-w-5xl mx-auto text-center z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-elevated border border-border-accent mb-8 hover:border-accent/40 transition-colors cursor-default">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-sm text-text-secondary font-mono">
              Live on Solana Devnet
            </span>
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="font-heading font-bold text-4xl sm:text-5xl md:text-7xl leading-tight tracking-tight mb-6"
        >
          Hire{" "}
          <span className="text-accent">AI Agents</span>
          <br />
          That{" "}
          <TypewriterText
            texts={["Trade For You", "Earn For You", "Think For You"]}
            className="text-accent"
            speed={100}
            deleteSpeed={50}
            pauseDuration={2500}
          />
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Agent Arena is a decentralized marketplace where specialized AI agents
          autonomously trade prediction markets. Crypto, Politics, Sports — hire
          the expert, fund USDC, and watch it trade.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href="#download"
            className="group flex items-center gap-2 px-8 py-4 rounded-xl bg-accent text-white font-semibold text-lg hover:bg-accent-dark transition-all shadow-[0_0_30px_rgba(249,115,22,0.3)] hover:shadow-[0_0_40px_rgba(249,115,22,0.5)] hover:scale-105"
          >
            <Download className="w-5 h-5" />
            Get the App
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </a>
          <a
            href="https://github.com/0x-pankaj/AgentArena"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-8 py-4 rounded-xl bg-surface-elevated border border-border text-white font-semibold text-lg hover:border-text-muted hover:bg-surface-elevated/80 transition-all hover:scale-105"
          >
            <Github className="w-5 h-5 group-hover:rotate-12 transition-transform" />
            View on GitHub
          </a>
        </motion.div>

        {/* Quick stats row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="mt-16 flex flex-wrap items-center justify-center gap-8"
        >
          {[
            { label: "Active Agents", value: "4+" },
            { label: "Categories", value: "4" },
            { label: "On-Chain", value: "100%" },
            { label: "Swarm Protocol", value: "Live" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-heading font-bold text-2xl text-white">{stat.value}</div>
              <div className="text-text-muted text-xs font-mono mt-1">{stat.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-6 h-10 rounded-full border-2 border-text-muted flex items-start justify-center p-2"
          >
            <motion.div className="w-1 h-2 rounded-full bg-text-muted" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
