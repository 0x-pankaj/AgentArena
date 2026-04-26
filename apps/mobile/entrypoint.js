// Import required polyfills first
import 'fast-text-encoding';
import 'react-native-get-random-values';
import '@ethersproject/shims';
// Required for Solana web3.js
import { Buffer } from 'buffer';
global.Buffer = Buffer;

// Suppress known Expo dev client "keep awake" error in React Native 0.81 New Architecture
import { LogBox } from 'react-native';
LogBox.ignoreLogs([
  'Unable to activate keep awake',
  'setLayoutAnimationEnabledExperimental is currently a no-op'
]);

const originalConsoleError = console.error;
console.error = (...args) => {
  if (args[0] && typeof args[0] === 'string') {
    if (args[0].includes('Unable to activate keep awake') || args[0].includes('Reflect.construct')) {
      return; // Suppress these non-fatal dev errors
    }
  }
  originalConsoleError(...args);
};

// Then import the expo router
import 'expo-router/entry';
