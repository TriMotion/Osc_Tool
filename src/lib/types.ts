export interface OscMessage {
  address: string;
  args: OscArg[];
  timestamp: number;
  sourceIp?: string;
  sourcePort?: number;
}

export interface OscArg {
  type: "f" | "i" | "s" | "T" | "F";
  value: number | string | boolean;
}

export interface Preset {
  id: string;
  name: string;
  address: string;
  args: OscArg[];
  order: number;
}

export interface DiagnosticsResult {
  messagesSent: number;
  messagesReceived: number;
  dropRate: number;
  latencyMin: number;
  latencyAvg: number;
  latencyMax: number;
  throughput: number;
}

export interface ListenerConfig {
  port: number;
  bindAddress: string;
}

export interface SenderConfig {
  host: string;
  port: number;
}
