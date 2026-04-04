import { app } from "electron";
import fs from "fs";
import path from "path";
import { SavedEndpoint } from "../src/lib/types";
import { randomUUID } from "crypto";

export class EndpointsStore {
  private filePath: string;
  private endpoints: SavedEndpoint[] = [];

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "endpoints.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.endpoints = JSON.parse(raw);
      }
    } catch {
      this.endpoints = [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.endpoints, null, 2));
  }

  getAll(type?: "listener" | "sender"): SavedEndpoint[] {
    if (type) return this.endpoints.filter((e) => e.type === type);
    return [...this.endpoints];
  }

  add(endpoint: Omit<SavedEndpoint, "id">): SavedEndpoint {
    const newEndpoint: SavedEndpoint = { ...endpoint, id: randomUUID() };
    this.endpoints.push(newEndpoint);
    this.save();
    return newEndpoint;
  }

  update(id: string, updates: Partial<Omit<SavedEndpoint, "id">>): SavedEndpoint | null {
    const idx = this.endpoints.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    this.endpoints[idx] = { ...this.endpoints[idx], ...updates };
    this.save();
    return this.endpoints[idx];
  }

  remove(id: string): boolean {
    const len = this.endpoints.length;
    this.endpoints = this.endpoints.filter((e) => e.id !== id);
    if (this.endpoints.length < len) {
      this.save();
      return true;
    }
    return false;
  }
}
