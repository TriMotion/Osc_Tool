import { app } from "electron";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { DmxEffect, SacnConfig, OscDmxTrigger } from "../src/lib/dmx-types";

export class DmxStore {
  private configPath: string;
  private effectsPath: string;
  private triggersPath: string;
  private config: SacnConfig;
  private effects: DmxEffect[] = [];
  private triggers: OscDmxTrigger[] = [];

  constructor() {
    const dir = app.getPath("userData");
    this.configPath = path.join(dir, "dmx-config.json");
    this.effectsPath = path.join(dir, "dmx-effects.json");
    this.triggersPath = path.join(dir, "dmx-triggers.json");
    this.config = { universe: 7, enabled: false };
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        this.config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
      }
    } catch { /* use defaults */ }
    try {
      if (fs.existsSync(this.effectsPath)) {
        this.effects = JSON.parse(fs.readFileSync(this.effectsPath, "utf-8"));
      }
    } catch { this.effects = []; }
    try {
      if (fs.existsSync(this.triggersPath)) {
        this.triggers = JSON.parse(fs.readFileSync(this.triggersPath, "utf-8"));
      }
    } catch { this.triggers = []; }
  }

  private saveConfig(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private saveEffects(): void {
    fs.writeFileSync(this.effectsPath, JSON.stringify(this.effects, null, 2));
  }

  private saveTriggers(): void {
    fs.writeFileSync(this.triggersPath, JSON.stringify(this.triggers, null, 2));
  }

  getConfig(): SacnConfig { return this.config; }

  setConfig(config: SacnConfig): void {
    this.config = config;
    this.saveConfig();
  }

  getEffects(): DmxEffect[] { return this.effects; }

  saveEffect(effect: DmxEffect): DmxEffect {
    if (!effect.id) effect.id = randomUUID();
    const idx = this.effects.findIndex((e) => e.id === effect.id);
    if (idx >= 0) this.effects[idx] = effect;
    else this.effects.push(effect);
    this.saveEffects();
    return effect;
  }

  deleteEffect(id: string): void {
    this.effects = this.effects.filter((e) => e.id !== id);
    this.saveEffects();
  }

  getTriggers(): OscDmxTrigger[] { return this.triggers; }

  saveTrigger(trigger: OscDmxTrigger): OscDmxTrigger {
    if (!trigger.id) trigger.id = randomUUID();
    const idx = this.triggers.findIndex((t) => t.id === trigger.id);
    if (idx >= 0) this.triggers[idx] = trigger;
    else this.triggers.push(trigger);
    this.saveTriggers();
    return trigger;
  }

  deleteTrigger(id: string): void {
    this.triggers = this.triggers.filter((t) => t.id !== id);
    this.saveTriggers();
  }
}
