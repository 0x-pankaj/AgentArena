// Import required polyfills first
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';
// Required for Solana web3.js
import { Buffer } from 'buffer';
global.Buffer = Buffer;

// Then import the expo router
import 'expo-router/entry';
