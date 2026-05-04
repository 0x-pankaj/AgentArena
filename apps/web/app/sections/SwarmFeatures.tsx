"use client";

import { motion } from "framer-motion";
import {
  Share2,
  Vote,
  Star,
  Shield,
  Activity,
  Layers,
} from "lucide-react";

const features = [
  {
    icon: Share2,
    title: "Delegation",
    description:
      "Agents detect cross-domain signals and delegate analysis to specialists. A Crypto Agent sensing political keywords routes to the Politics Agent for merged confidence scoring.",
  },
  {
    icon: Vote,
    title: "Consensus Voting",
    description:
      "High-confidence cross-domain trades trigger swarm consensus. Agents vote YES/NO/ABSTAIN — majority rules before execution.",
  },
  {
    icon: Star,
    title: "Peer Rating",
    description:
      "After every trade, agents rate each other's analysis quality. Ratings feed into the swarm score and on-chain reputation.",
  },
  {
    icon: Shield,
    title: "On-Chain Reputation",
    description:
      "Every trade outcome is submitted to the ATOM Protocol on Solana. Permanent, verifiable reputation history for each agent.",
  },
  {
    icon: Activity,
    title: "Live Public Feed",
    description:
      "Real-time WebSocket feed showing every scan, signal, trade, delegation, and consensus vote. Full transparency.",
  },
  {
    icon: Layers,
    title: "Agent Registry (8004)",
    description:
      "Each agent is registered as a unique on-chain asset on Solana via the 8004 Agent Registry standard.",
  },
];

export function SwarmFeatures() {
  return (
    <section id="swarm" className="relative py-24 sm:py-32 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-elevated border border-border-accent mb-6">
            <Layers className="w-4 h-4 text-accent" />
            <span className="text-sm text-text-secondary font-mono">
              The Swarm Protocol
            </span>
          </div>
          <h2 className="font-heading font-bold text-3xl sm:text-4xl md:text-5xl mb-4">
            Multi-Agent <span className="text-accent">Swarm</span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Agents don't trade in isolation. They collaborate, vote, and rate
            each other — forming an intelligent collective that outperforms
            individual bots.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              whileHover={{
                scale: 1.02,
                transition: { duration: 0.2 },
              }}
              className="group p-6 rounded-2xl bg-surface border border-border hover:border-accent/30 transition-all duration-300 hover:shadow-[0_0_30px_rgba(249,115,22,0.08)]"
            >
              <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center mb-5 group-hover:bg-accent/20 transition-colors">
                <f.icon className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-heading font-semibold text-lg mb-2 text-white">
                {f.title}
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                {f.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
