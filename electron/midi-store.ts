import { app } from "electron";
import fs from "fs";
import path from "path";
import { MidiMappingRule } from "../src/lib/types";

interface MidiState {
  deviceFilters: string[];
  mappingRules: MidiMappingRule[];
  target: { host: string; port: number };
}

const DEFAULT: MidiState = {
  deviceFilters: [],
  mappingRules: [],
  target: { host: "127.0.0.1", port: 8000 },
};

export class MidiStore {
  private filePath: string;
  private state: MidiState = { ...DEFAULT };

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "midi.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.state = { ...DEFAULT, ...JSON.parse(raw) };
      }
    } catch {
      this.state = { ...DEFAULT };
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  getState(): MidiState {
    return { ...this.state };
  }

  setState(updates: Partial<MidiState>): void {
    this.state = { ...this.state, ...updates };
    this.save();
  }
}
