"use client";

import { motion } from "framer-motion";

export function GradientOrbs() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      <motion.div
        className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full opacity-20"
        style={{
          background: "radial-gradient(circle, rgba(249,115,22,0.4) 0%, transparent 70%)",
        }}
        animate={{
          x: [0, 30, 0],
          y: [0, -20, 0],
          scale: [1, 1.1, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute top-1/3 -right-40 w-[600px] h-[600px] rounded-full opacity-15"
        style={{
          background: "radial-gradient(circle, rgba(168,85,247,0.35) 0%, transparent 70%)",
        }}
        animate={{
          x: [0, -40, 0],
          y: [0, 30, 0],
          scale: [1, 1.15, 1],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-40 left-1/3 w-[400px] h-[400px] rounded-full opacity-10"
        style={{
          background: "radial-gradient(circle, rgba(59,130,246,0.35) 0%, transparent 70%)",
        }}
        animate={{
          x: [0, 20, 0],
          y: [0, -30, 0],
          scale: [1, 1.08, 1],
        }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
