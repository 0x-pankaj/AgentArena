import { IS_SIMULATED, TEST_WALLET_BALANCE_USDC, TEST_WALLET_BALANCE_SOL } from "@agent-arena/shared";
import { getWalletBalance } from "./privy";

export async function getEffectiveBalance(
  walletAddress: string
): Promise<{ usdc: number; sol: number }> {
  if (IS_SIMULATED) {
    return { usdc: TEST_WALLET_BALANCE_USDC, sol: TEST_WALLET_BALANCE_SOL };
  }
  return getWalletBalance(walletAddress);
}