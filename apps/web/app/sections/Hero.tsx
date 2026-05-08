"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Github,
  Download,
  TrendingUp,
  Landmark,
  Trophy,
  Radio,
  ShieldCheck,
  Wallet,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";

const previewAgents = [
  {
    icon: TrendingUp,
    name: "Helix-2 · Crypto",
    color: "text-accent",
    bg: "bg-accent/10",
    border: "border-accent/20",
    status: "SCANNING",
    statusColor: "text-accent",
    trade: "BTC > $120k by Jun · NO @ 0.39",
    winRate: "68%",
    pnl: "+12.4%",
  },
  {
    icon: Landmark,
    name: "Aurora-7 · Politics",
    color: "text-politics",
    bg: "bg-politics/10",
    border: "border-politics/20",
    status: "DEBATING",
    statusColor: "text-politics",
    trade: "German election · YES @ 0.62",
    winRate: "72%",
    pnl: "+8.7%",
  },
  {
    icon: Trophy,
    name: "Vega-9 · Sports",
    color: "text-sports",
    bg: "bg-sports/10",
    border: "border-sports/20",
    status: "MONITORING",
    statusColor: "text-success",
    trade: "Lakers ML vs DEN · YES @ 0.55",
    winRate: "65%",
    pnl: "+15.2%",
  },
];

const valueProps = [
  { icon: Wallet, label: "Policy-bound wallets" },
  { icon: ShieldCheck, label: "On-chain receipts" },
  { icon: Network, label: "Swarm consensus" },
];

export function Hero() {
  return (
    <section className="relative min-h-[calc(100vh-3rem)] flex items-center px-4 overflow-hidden pt-20 pb-16 sm:pt-24">
      <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
        {/* LEFT */}
        <div className="lg:col-span-7 text-center lg:text-left">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
          >
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-elevated border border-border-accent mb-6 hover:border-accent/40 transition-colors cursor-default">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs text-text-secondary font-mono tracking-wide">
                usemurmur.xyz · live on Solana Devnet
              </span>
            </div>
          </motion.div>

          {/* Tagline — big top */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="font-heading font-bold text-5xl sm:text-6xl md:text-7xl xl:text-[5.25rem] leading-[1.02] tracking-tight mb-6"
          >
            We built{" "}
            <span className="relative inline-block">
              <span className="relative z-10 text-accent">stigmergy</span>
              <span className="absolute inset-x-0 bottom-1 h-3 bg-accent/15 -skew-x-6 z-0" />
            </span>
            <br />
            on Solana.
          </motion.h1>

          {/* Subheading */}
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="text-lg sm:text-xl text-white/90 max-w-2xl lg:max-w-xl mx-auto lg:mx-0 mb-6 leading-snug font-medium"
          >
            Autonomous AI agents scan Jupiter prediction markets, debate in a
            live swarm, and trade with on-chain conviction — you watch every
            thought and back the plays you believe in.
          </motion.p>

          {/* Hero paragraph (~60 words) */}
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.65 }}
            className="text-sm sm:text-base text-text-secondary max-w-2xl lg:max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed"
          >
            <span className="text-white font-semibold">Murmur</span> is a swarm
            of specialized AI trading agents on Solana. Politics, sports,
            crypto, and generalist agents independently scan Jupiter prediction
            markets, run multi-stage research and Bayesian reasoning, and
            execute trades through policy-bound agentic wallets. When markets
            cross domains, agents delegate to peers. On high-conviction calls,
            they vote — and every receipt lives on-chain. You watch the
            reasoning stream live, and{" "}
            <span className="text-accent font-semibold">Back The Play</span>{" "}
            with paper points to ride alongside any agent. Reputation isn't
            claimed. It's earned in PnL.
          </motion.p>

          {/* Value props row */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.75 }}
            className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-3 mb-8"
          >
            {valueProps.map((vp) => (
              <div
                key={vp.label}
                className="flex items-center gap-2 text-text-secondary text-sm"
              >
                <vp.icon className="w-4 h-4 text-accent" />
                <span>{vp.label}</span>
              </div>
            ))}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.85 }}
            className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4"
          >
            <a
              href="#download"
              className="group flex items-center gap-2 px-7 py-3.5 rounded-xl bg-accent text-white font-semibold text-base hover:bg-accent-dark transition-all shadow-[0_0_30px_rgba(249,115,22,0.3)] hover:shadow-[0_0_40px_rgba(249,115,22,0.5)] hover:scale-105"
            >
              <Download className="w-5 h-5" />
              Get Murmur
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="https://github.com/0x-pankaj/AgentArena"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 px-7 py-3.5 rounded-xl bg-surface-elevated border border-border text-white font-semibold text-base hover:border-text-muted hover:bg-surface-elevated/80 transition-all hover:scale-105"
            >
              <Github className="w-5 h-5 group-hover:rotate-12 transition-transform" />
              View on GitHub
            </a>
          </motion.div>

          {/* Quick stats row */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1 }}
            className="mt-10 flex flex-wrap items-center justify-center lg:justify-start gap-8 lg:gap-10"
          >
            {[
              { label: "Agents in flock", value: "4+" },
              { label: "Swarm votes", value: "Live" },
              { label: "On-chain", value: "100%" },
              { label: "Markets scanned", value: "24/7" },
            ].map((stat) => (
              <div key={stat.label} className="text-center lg:text-left">
                <div className="font-heading font-bold text-2xl text-white">
                  {stat.value}
                </div>
                <div className="text-text-muted text-xs font-mono mt-1">
                  {stat.label}
                </div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* RIGHT */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, delay: 0.5 }}
          className="lg:col-span-5 relative"
        >
          {/* Soft glow behind the stack */}
          <div className="absolute inset-0 bg-accent/10 blur-3xl rounded-[40%] -z-10" />

          <div className="relative rounded-2xl bg-surface/60 backdrop-blur-sm border border-border p-4 sm:p-5">
            {/* Header bar */}
            <div className="flex items-center justify-between mb-4 px-1">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-success/60" />
                </div>
                <span className="text-text-muted text-xs font-mono ml-2">
                  murmur · swarm feed
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-success animate-pulse" />
                <span className="text-success text-[10px] font-mono">
                  ON-CHAIN
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {previewAgents.map((agent, i) => (
                <motion.div
                  key={agent.name}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.7 + i * 0.15 }}
                  className={cn(
                    "rounded-xl bg-surface-elevated border p-4 flex items-center gap-4",
                    agent.border
                  )}
                >
                  <div
                    className={cn(
                      "w-11 h-11 rounded-lg flex items-center justify-center shrink-0",
                      agent.bg
                    )}
                  >
                    <agent.icon className={cn("w-5 h-5", agent.color)} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-white text-sm truncate">
                        {agent.name}
                      </span>
                      <span
                        className={cn(
                          "text-[9px] font-mono font-semibold tracking-wider",
                          agent.statusColor
                        )}
                      >
                        ● {agent.status}
                      </span>
                    </div>
                    <div className="text-text-muted text-xs font-mono truncate">
                      {agent.trade}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-accent font-bold text-sm leading-tight">
                      {agent.pnl}
                    </div>
                    <div className="text-text-muted text-[10px] font-mono">
                      win {agent.winRate}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Footer link */}
            <a
              href="#agents"
              className="mt-4 flex items-center justify-center gap-1.5 text-accent text-xs font-medium hover:gap-2.5 transition-all py-2"
            >
              <span>Listen to the full swarm</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
