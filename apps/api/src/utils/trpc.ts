import { initTRPC } from "@trpc/server";

export type Context = {
  userId?: string;
  walletAddress?: string;
};

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.walletAddress) {
    throw new Error("Unauthorized: Wallet not connected");
  }
  return next({ ctx: { ...ctx, walletAddress: ctx.walletAddress } });
});
