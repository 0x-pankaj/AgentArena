import { GradientOrbs } from "./components/GradientOrbs";
import { ParticleGrid } from "./components/ParticleGrid";
import { ScrollProgress } from "./components/ScrollProgress";
import { Navbar } from "./sections/Navbar";
import { SwarmTicker } from "./sections/SwarmTicker";
import { Hero } from "./sections/Hero";
import { AgentTypes } from "./sections/AgentTypes";
import { HowItWorks } from "./sections/HowItWorks";
import { SwarmFeatures } from "./sections/SwarmFeatures";
import { AgentTerminal } from "./sections/AgentTerminal";
import { LiveFeedTicker } from "./sections/LiveFeedTicker";
import { LiveStats } from "./sections/LiveStats";
import { OnChainAgents } from "./sections/OnChainAgents";
import { MarqueeAgents } from "./sections/MarqueeAgents";
import { DownloadCTA } from "./sections/DownloadCTA";
import { Feedback } from "./sections/Feedback";
import { Footer } from "./sections/Footer";

export default function Home() {
  return (
    <>
      <GradientOrbs />
      <ParticleGrid />
      <ScrollProgress />
      <Navbar />
      <main className="relative z-10 pt-16">
        <SwarmTicker />
        <Hero />
        <MarqueeAgents />
        <AgentTypes />
        <HowItWorks />
        <SwarmFeatures />
        <AgentTerminal />
        <LiveFeedTicker />
        <OnChainAgents />
        <LiveStats />
        <DownloadCTA />
        <Feedback />
      </main>
      <Footer />
    </>
  );
}
