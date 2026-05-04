"use client";

import { motion } from "framer-motion";
import { TrendingUp, Landmark, Trophy, Globe, Zap } from "lucide-react";

const agents = [
  { name: "Crypto Agent", icon: TrendingUp, color: "text-accent" },
  { name: "Politics Agent", icon: Landmark, color: "text-politics" },
  { name: "Sports Agent", icon: Trophy, color: "text-sports" },
  { name: "General Agent", icon: Globe, color: "text-geo" },
  { name: "Crypto Agent", icon: TrendingUp, color: "text-accent" },
  { name: "Politics Agent", icon: Landmark, color: "text-politics" },
  { name: "Sports Agent", icon: Trophy, color: "text-sports" },
  { name: "General Agent", icon: Globe, color: "text-geo" },
];

export function MarqueeAgents() {
  return (
    <section className="relative py-12 overflow-hidden border-y border-border">
      <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-background to-transparent z-10" />
      <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-background to-transparent z-10" />

      <motion.div
        animate={{ x: [0, -1920] }}
        transition={{
          x: {
            duration: 30,
            repeat: Infinity,
            repeatType: "loop",
            ease: "linear",
          },
        }}
        className="flex items-center gap-12 whitespace-nowrap"
      >
        {[...agents, ...agents, ...agents, ...agents].map((agent, i) => (
          <div key={i} className="flex items-center gap-3 shrink-0">
            <agent.icon className={`w-5 h-5 ${agent.color}`} />
            <span className="text-lg font-heading font-semibold text-text-secondary">
              {agent.name}
            </span>
            <Zap className="w-4 h-4 text-accent" />
          </div>
        ))}
      </motion.div>
    </section>
  );
}
