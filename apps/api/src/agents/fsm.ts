import { AgentState } from "@agent-arena/shared";

export type StateTransition =
  | "user_hires"
  | "markets_found"
  | "no_markets"
  | "edge_found"
  | "no_edge"
  | "order_placed"
  | "order_failed"
  | "position_closed"
  | "cycle_complete"
  | "stop_loss"
  | "daily_limit"
  | "agent_stop";

export interface FSMContext {
  agentId: string;
  jobId: string;
  consecutiveFailures: number;
  lastTransition: number;
  paused: boolean;
  pauseReason: string | null;
}

// Valid transitions map
const TRANSITIONS: Record<AgentState, Partial<Record<StateTransition, AgentState>>> = {
  IDLE: {
    user_hires: "SCANNING",
  },
  SCANNING: {
    markets_found: "ANALYZING",
    no_markets: "IDLE",
    agent_stop: "IDLE",
  },
  ANALYZING: {
    edge_found: "EXECUTING",
    no_edge: "SCANNING",
    agent_stop: "IDLE",
  },
  EXECUTING: {
    order_placed: "MONITORING",
    order_failed: "SCANNING",
    agent_stop: "IDLE",
  },
  MONITORING: {
    position_closed: "CLOSING",
    markets_found: "SCANNING",
    agent_stop: "CLOSING",
  },
  CLOSING: {
    cycle_complete: "SETTLING",
  },
  SETTLING: {
    cycle_complete: "IDLE",
  },
};

// Any-state transitions (override normal transitions)
const ANY_STATE_TRANSITIONS: Partial<Record<StateTransition, AgentState>> = {
  stop_loss: "CLOSING",
  daily_limit: "IDLE",
  agent_stop: "IDLE",
};

export class AgentFSM {
  private state: AgentState = "IDLE";
  private context: FSMContext;

  constructor(agentId: string, jobId: string) {
    this.context = {
      agentId,
      jobId,
      consecutiveFailures: 0,
      lastTransition: Date.now(),
      paused: false,
      pauseReason: null,
    };
  }

  getState(): AgentState {
    return this.state;
  }

  getContext(): Readonly<FSMContext> {
    return { ...this.context };
  }

  canTransition(transition: StateTransition): boolean {
    // Check any-state transitions first
    if (ANY_STATE_TRANSITIONS[transition]) {
      return true;
    }
    const validTransitions = TRANSITIONS[this.state];
    return transition in validTransitions;
  }

  transition(event: StateTransition): AgentState {
    // Check any-state transitions first
    const anyStateTarget = ANY_STATE_TRANSITIONS[event];
    if (anyStateTarget) {
      const prev = this.state;
      this.state = anyStateTarget;
      this.context.lastTransition = Date.now();

      if (event === "daily_limit") {
        this.context.paused = true;
        this.context.pauseReason = "Daily loss limit reached";
      }

      console.log(
        `[FSM ${this.context.agentId}] ${prev} -> ${this.state} (any-state: ${event})`
      );
      return this.state;
    }

    // Normal transitions
    const validTransitions = TRANSITIONS[this.state];
    const target = validTransitions[event];

    if (!target) {
      throw new Error(
        `Invalid transition: ${event} from state ${this.state}`
      );
    }

    const prev = this.state;
    this.state = target;
    this.context.lastTransition = Date.now();

    // Track failures
    if (event === "order_failed") {
      this.context.consecutiveFailures++;
    } else {
      this.context.consecutiveFailures = 0;
    }

    console.log(
      `[FSM ${this.context.agentId}] ${prev} -> ${this.state} (${event})`
    );
    return this.state;
  }

  isPaused(): boolean {
    return this.context.paused;
  }

  unpause(): void {
    this.context.paused = false;
    this.context.pauseReason = null;
  }

  pause(reason: string): void {
    this.context.paused = true;
    this.context.pauseReason = reason;
  }

  reset(): void {
    this.state = "IDLE";
    this.context.consecutiveFailures = 0;
    this.context.paused = false;
    this.context.pauseReason = null;
  }

  // Restore state from persisted snapshot (e.g., Redis/DB)
  restoreState(state: AgentState, context?: Partial<FSMContext>): void {
    // Validate state is a known state
    const validStates = Object.keys(TRANSITIONS) as AgentState[];
    if (!validStates.includes(state)) {
      console.warn(`[FSM ${this.context.agentId}] Invalid state "${state}" — falling back to IDLE`);
      this.state = "IDLE";
      return;
    }

    this.state = state;
    if (context) {
      if (context.consecutiveFailures !== undefined) this.context.consecutiveFailures = context.consecutiveFailures;
      if (context.lastTransition !== undefined) this.context.lastTransition = context.lastTransition;
      if (context.paused !== undefined) this.context.paused = context.paused;
      if (context.pauseReason !== undefined) this.context.pauseReason = context.pauseReason;
    }
    console.log(`[FSM ${this.context.agentId}] Restored to state: ${this.state}`);
  }

  // How long in current state (ms)
  timeInState(): number {
    return Date.now() - this.context.lastTransition;
  }

  // Serialize for logging/DB
  toJSON(): { state: AgentState; context: FSMContext } {
    return {
      state: this.state,
      context: { ...this.context },
    };
  }
}
