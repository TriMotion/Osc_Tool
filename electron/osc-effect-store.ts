import { app } from "electron";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { OscEffect } from "../src/lib/osc-effect-types";

export class OscEffectStore {
  private filePath: string;
  private effects: OscEffect[] = [];

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "osc-effects.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.effects = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      }
    } catch {
      this.effects = [];
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.effects, null, 2));
  }

  getAll(): OscEffect[] {
    return this.effects;
  }

  saveEffect(effect: OscEffect): OscEffect {
    if (!effect.id) effect.id = randomUUID();
    const idx = this.effects.findIndex((e) => e.id === effect.id);
    if (idx >= 0) this.effects[idx] = effect;
    else this.effects.push(effect);
    this.save();
    return effect;
  }

  deleteEffect(id: string): void {
    this.effects = this.effects.filter((e) => e.id !== id);
    this.save();
  }
}
