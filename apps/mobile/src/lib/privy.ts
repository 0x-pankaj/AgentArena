import { PrivyProvider } from '@privy-io/expo';

const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? '';
const PRIVY_MOBILE_CLIENT = process.env.EXPO_PUBLIC_PRIVY_MOBILE_CLIENT ?? '';

export { PrivyProvider, PRIVY_APP_ID, PRIVY_MOBILE_CLIENT };
