import type { Context } from "./trpc";

export function createContext({ req }: { req: Request }): Context {
  const walletAddress = req.headers.get("x-wallet-address") ?? undefined;
  return { walletAddress };
}
