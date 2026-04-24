import { router } from "../utils/trpc";
import { agentRouter } from "./agent";
import { marketRouter } from "./market";
import { tradeRouter, positionRouter, paperTradingRouter } from "./trade";
import { jobRouter } from "./job";
import { userRouter } from "./user";
import { leaderboardRouter } from "./leaderboard";
import { feedRouter } from "./feed";
import { evolutionRouter } from "./evolution";

export const appRouter = router({
  agent: agentRouter,
  market: marketRouter,
  trade: tradeRouter,
  position: positionRouter,
  paperTrading: paperTradingRouter,
  job: jobRouter,
  user: userRouter,
  leaderboard: leaderboardRouter,
  feed: feedRouter,
  evolution: evolutionRouter,
});

export type AppRouter = typeof appRouter;
