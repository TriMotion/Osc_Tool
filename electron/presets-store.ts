import { app } from "electron";
import fs from "fs";
import path from "path";
import { Preset } from "../src/lib/types";
import { randomUUID } from "crypto";

export class PresetsStore {
  private filePath: string;
  private presets: Preset[] = [];

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "presets.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.presets = JSON.parse(raw);
      }
    } catch {
      this.presets = [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.presets, null, 2));
  }

  getAll(): Preset[] {
    return [...this.presets].sort((a, b) => a.order - b.order);
  }

  add(preset: Omit<Preset, "id" | "order">): Preset {
    const newPreset: Preset = {
      ...preset,
      id: randomUUID(),
      order: this.presets.length,
    };
    this.presets.push(newPreset);
    this.save();
    return newPreset;
  }

  update(id: string, updates: Partial<Omit<Preset, "id">>): Preset | null {
    const idx = this.presets.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    this.presets[idx] = { ...this.presets[idx], ...updates };
    this.save();
    return this.presets[idx];
  }

  remove(id: string): boolean {
    const len = this.presets.length;
    this.presets = this.presets.filter((p) => p.id !== id);
    if (this.presets.length < len) {
      this.save();
      return true;
    }
    return false;
  }

  reorder(ids: string[]): void {
    const map = new Map(this.presets.map((p) => [p.id, p]));
    this.presets = ids.map((id, i) => {
      const preset = map.get(id)!;
      return { ...preset, order: i };
    });
    this.save();
  }

  exportAll(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  importPresets(json: string): Preset[] {
    const imported: Preset[] = JSON.parse(json);
    const baseOrder = this.presets.length;
    const newPresets = imported.map((p, i) => ({
      ...p,
      id: randomUUID(),
      order: baseOrder + i,
    }));
    this.presets.push(...newPresets);
    this.save();
    return newPresets;
  }
}
