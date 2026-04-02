// Simple circuit breaker for external API calls.
// Prevents hammering a failing API by tracking failures and opening the circuit.

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
}

const circuits = new Map<string, CircuitState>();

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT_MS = 30_000;

function getCircuit(key: string): CircuitState {
  if (!circuits.has(key)) {
    circuits.set(key, { failures: 0, lastFailure: 0, state: "closed" });
  }
  return circuits.get(key)!;
}

export function isCircuitOpen(key: string): boolean {
  const circuit = getCircuit(key);
  if (circuit.state === "closed") return false;
  if (circuit.state === "open") {
    if (Date.now() - circuit.lastFailure > RESET_TIMEOUT_MS) {
      circuit.state = "half-open";
      return false;
    }
    return true;
  }
  return false; // half-open: allow one request through
}

export function recordCircuitSuccess(key: string): void {
  const circuit = getCircuit(key);
  circuit.failures = 0;
  circuit.state = "closed";
}

export function recordCircuitFailure(key: string): void {
  const circuit = getCircuit(key);
  circuit.failures++;
  circuit.lastFailure = Date.now();
  if (circuit.failures >= FAILURE_THRESHOLD) {
    circuit.state = "open";
    console.warn(`[CircuitBreaker] Circuit OPEN for ${key} after ${circuit.failures} failures`);
  }
}

export async function withCircuitBreaker<T>(
  key: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  if (isCircuitOpen(key)) {
    return fallback;
  }
  try {
    const result = await fn();
    recordCircuitSuccess(key);
    return result;
  } catch (err) {
    recordCircuitFailure(key);
    return fallback;
  }
}
