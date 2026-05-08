"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Landmark, Trophy, Globe, ArrowRight, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const agents = [
  {
    icon: TrendingUp,
    name: "Crypto Agent",
    category: "crypto",
    color: "text-accent",
    bg: "bg-accent/10",
    border: "border-accent/20",
    hoverBorder: "hover:border-accent/50",
    glow: "hover:shadow-[0_0_40px_rgba(249,115,22,0.15)]",
    sources: ["CoinGecko", "Jupiter", "GDELT", "ACLED"],
    description:
      "Analyzes crypto prediction markets including BTC, ETH, SOL, ETFs, and regulations. Autonomous trading with real-time data.",
    stats: { winRate: "68%", trades: "142", avgReturn: "+12.4%" },
    status: "SCANNING",
  },
  {
    icon: Landmark,
    name: "Politics Agent",
    category: "politics",
    color: "text-politics",
    bg: "bg-politics/10",
    border: "border-politics/20",
    hoverBorder: "hover:border-politics/50",
    glow: "hover:shadow-[0_0_40px_rgba(168,85,247,0.15)]",
    sources: ["GDELT", "FRED", "News APIs"],
    description:
      "Analyzes political & geopolitical prediction markets including elections, wars, sanctions, and treaties.",
    stats: { winRate: "72%", trades: "89", avgReturn: "+8.7%" },
    status: "THINKING",
  },
  {
    icon: Trophy,
    name: "Sports Agent",
    category: "sports",
    color: "text-sports",
    bg: "bg-sports/10",
    border: "border-sports/20",
    hoverBorder: "hover:border-sports/50",
    glow: "hover:shadow-[0_0_40px_rgba(34,197,94,0.15)]",
    sources: ["ESPN APIs", "Social Signals"],
    description:
      "Analyzes sports prediction markets including NFL, NBA, Soccer, MMA, and Tennis with social sentiment.",
    stats: { winRate: "65%", trades: "67", avgReturn: "+15.2%" },
    status: "IDLE",
  },
  {
    icon: Globe,
    name: "General Agent",
    category: "general",
    color: "text-geo",
    bg: "bg-geo/10",
    border: "border-geo/20",
    hoverBorder: "hover:border-geo/50",
    glow: "hover:shadow-[0_0_40px_rgba(59,130,246,0.15)]",
    sources: ["NASA FIRMS", "Weather", "Conflicts"],
    description:
      "Cross-category generalist scanning politics, crypto, sports, and economics. The jack-of-all-trades agent.",
    stats: { winRate: "61%", trades: "103", avgReturn: "+9.1%" },
    status: "MONITORING",
  },
];

const statusColors: Record<string, string> = {
  SCANNING: "text-accent",
  THINKING: "text-politics",
  IDLE: "text-text-muted",
  MONITORING: "text-success",
};

const container = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.15,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

export function AgentTypes() {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <section id="agents" className="relative py-24 sm:py-32 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-heading font-bold text-3xl sm:text-4xl md:text-5xl mb-4">
            Meet the <span className="text-accent">flock</span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Each agent is a domain expert with its own policy-bound wallet,
            data sources, and trading strategy. They scan independently,
            delegate across domains, and vote on high-conviction plays.
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {agents.map((agent, index) => (
            <motion.div
              key={agent.name}
              variants={item}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              whileHover={{ y: -8, transition: { duration: 0.3 } }}
              className={cn(
                "group relative p-6 rounded-2xl bg-surface border transition-all duration-500 cursor-pointer overflow-hidden",
                agent.border,
                agent.hoverBorder,
                agent.glow
              )}
            >
              {/* Live status badge */}
              <div className="absolute top-4 right-4 flex items-center gap-1.5">
                <Radio className={cn("w-3 h-3 animate-pulse", statusColors[agent.status])} />
                <span className={cn("text-[10px] font-mono font-semibold", statusColors[agent.status])}>
                  {agent.status}
                </span>
              </div>

              <div
                className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110",
                  agent.bg
                )}
              >
                <agent.icon className={cn("w-6 h-6", agent.color)} />
              </div>

              <h3 className="font-heading font-semibold text-xl mb-2 text-white">
                {agent.name}
              </h3>
              <p className="text-text-secondary text-sm mb-4 leading-relaxed">
                {agent.description}
              </p>

              {/* Source tags */}
              <div className="flex flex-wrap gap-2 mb-4">
                {agent.sources.map((source) => (
                  <span
                    key={source}
                    className="px-2 py-1 rounded-md bg-surface-elevated text-text-muted text-xs font-mono"
                  >
                    {source}
                  </span>
                ))}
              </div>

              {/* Expandable stats */}
              <AnimatePresence>
                {hoveredIndex === index && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="border-t border-border pt-4 mt-2"
                  >
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center">
                        <div className="text-white font-bold text-sm">{agent.stats.winRate}</div>
                        <div className="text-text-muted text-[10px] font-mono">Win Rate</div>
                      </div>
                      <div className="text-center">
                        <div className="text-white font-bold text-sm">{agent.stats.trades}</div>
                        <div className="text-text-muted text-[10px] font-mono">Trades</div>
                      </div>
                      <div className="text-center">
                        <div className="text-accent font-bold text-sm">{agent.stats.avgReturn}</div>
                        <div className="text-text-muted text-[10px] font-mono">Avg Return</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-center gap-1 text-accent text-xs font-medium group/link">
                      <span>View Agent Profile</span>
                      <ArrowRight className="w-3 h-3 group-hover/link:translate-x-1 transition-transform" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
