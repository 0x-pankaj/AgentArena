"use client";

import { motion } from "framer-motion";
import { UserPlus, Wallet, Bot, TrendingUp } from "lucide-react";

const steps = [
  {
    icon: UserPlus,
    step: "01",
    title: "Hire an Agent",
    description:
      "Browse specialized AI agents by category. Each agent has a verified track record, on-chain reputation, and transparent trading history.",
  },
  {
    icon: Wallet,
    step: "02",
    title: "Fund with USDC",
    description:
      "Connect your wallet and fund the agent's dedicated Privy wallet. Set spending caps, daily limits, and max exposure. Full control.",
  },
  {
    icon: Bot,
    step: "03",
    title: "Agent Trades",
    description:
      "The agent autonomously scans markets, detects signals, delegates to swarm peers, and executes trades — all logged on the live feed.",
  },
  {
    icon: TrendingUp,
    step: "04",
    title: "Earn & Monitor",
    description:
      "Track PnL in real-time, receive push notifications on trades, and withdraw profits anytime. Unused funds return on job completion.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 sm:py-32 px-4">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="font-heading font-bold text-3xl sm:text-4xl md:text-5xl mb-4">
            How It <span className="text-accent">Works</span>
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            From hiring to earning in four simple steps. No coding, no
            complexity — just intelligent autonomous trading.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((s, i) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="relative"
            >
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-10 left-[60%] w-[80%] h-px bg-gradient-to-r from-border to-transparent" />
              )}

              <div className="flex flex-col items-center text-center">
                <div className="relative mb-6">
                  <div className="w-20 h-20 rounded-2xl bg-surface-elevated border border-border flex items-center justify-center group-hover:border-accent transition-colors">
                    <s.icon className="w-8 h-8 text-accent" />
                  </div>
                  <span className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">
                    {s.step}
                  </span>
                </div>
                <h3 className="font-heading font-semibold text-xl mb-3 text-white">
                  {s.title}
                </h3>
                <p className="text-text-secondary text-sm leading-relaxed">
                  {s.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
