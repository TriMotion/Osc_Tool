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

export interface SavedEndpoint {
  id: string;
  name: string;
  host: string;
  port: number;
  type: "listener" | "sender";
}

// --- Deck types ---

export interface Deck {
  id: string;
  name: string;
  gridColumns: number;
  gridRows: number;
  pages: DeckPage[];
}

export interface DeckPage {
  id: string;
  name: string;
  items: DeckItem[];
  groups: DeckGroup[];
}

export interface DeckGroup {
  id: string;
  name: string;
  color: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  items: DeckItem[];
}

export interface DeckItem {
  id: string;
  name: string;
  type: "button" | "slider" | "xy-pad";
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  oscAddress: string;
  oscTarget: { host: string; port: number };
  color: string;
  config: ButtonConfig | SliderConfig | XYPadConfig;
}

export interface ButtonConfig {
  mode: "trigger" | "toggle";
  triggerValue: OscArg;
  toggleOnValue: OscArg;
  toggleOffValue: OscArg;
}

export interface SliderConfig {
  orientation: "horizontal" | "vertical";
  min: number;
  max: number;
  valueType: "f" | "i";
}

export interface XYPadConfig {
  xAddress: string;
  yAddress: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}
