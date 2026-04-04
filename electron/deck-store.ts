import { app } from "electron";
import fs from "fs";
import path from "path";
import { Deck, DeckPage, DeckItem, DeckGroup } from "../src/lib/types";
import { randomUUID } from "crypto";

export class DeckStore {
  private filePath: string;
  private decks: Deck[] = [];

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "decks.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.decks = JSON.parse(raw);
      }
    } catch {
      this.decks = [];
    }
    if (this.decks.length === 0) {
      this.decks.push(this.createDefaultDeck());
      this.save();
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.decks, null, 2));
  }

  private createDefaultDeck(): Deck {
    return {
      id: randomUUID(),
      name: "Default",
      gridColumns: 8,
      gridRows: 6,
      pages: [{ id: randomUUID(), name: "Main", items: [], groups: [] }],
    };
  }

  private findPage(deckId: string, pageId: string): { deck: Deck; page: DeckPage } | null {
    const deck = this.decks.find((d) => d.id === deckId);
    if (!deck) return null;
    const page = deck.pages.find((p) => p.id === pageId);
    if (!page) return null;
    return { deck, page };
  }

  getDecks(): Deck[] {
    return this.decks;
  }

  getDeck(id: string): Deck | null {
    return this.decks.find((d) => d.id === id) ?? null;
  }

  createDeck(name: string): Deck {
    const deck: Deck = {
      id: randomUUID(),
      name,
      gridColumns: 8,
      gridRows: 6,
      pages: [{ id: randomUUID(), name: "Main", items: [], groups: [] }],
    };
    this.decks.push(deck);
    this.save();
    return deck;
  }

  updateDeck(id: string, updates: Partial<Pick<Deck, "name" | "gridColumns" | "gridRows">>): Deck | null {
    const deck = this.decks.find((d) => d.id === id);
    if (!deck) return null;
    Object.assign(deck, updates);
    this.save();
    return deck;
  }

  deleteDeck(id: string): boolean {
    const len = this.decks.length;
    this.decks = this.decks.filter((d) => d.id !== id);
    if (this.decks.length < len) {
      if (this.decks.length === 0) {
        this.decks.push(this.createDefaultDeck());
      }
      this.save();
      return true;
    }
    return false;
  }

  createPage(deckId: string, name: string): DeckPage | null {
    const deck = this.decks.find((d) => d.id === deckId);
    if (!deck) return null;
    const page: DeckPage = { id: randomUUID(), name, items: [], groups: [] };
    deck.pages.push(page);
    this.save();
    return page;
  }

  updatePage(deckId: string, pageId: string, updates: Partial<Pick<DeckPage, "name">>): DeckPage | null {
    const found = this.findPage(deckId, pageId);
    if (!found) return null;
    Object.assign(found.page, updates);
    this.save();
    return found.page;
  }

  deletePage(deckId: string, pageId: string): boolean {
    const deck = this.decks.find((d) => d.id === deckId);
    if (!deck || deck.pages.length <= 1) return false;
    const len = deck.pages.length;
    deck.pages = deck.pages.filter((p) => p.id !== pageId);
    if (deck.pages.length < len) {
      this.save();
      return true;
    }
    return false;
  }

  addItem(deckId: string, pageId: string, item: Omit<DeckItem, "id">): DeckItem | null {
    const found = this.findPage(deckId, pageId);
    if (!found) return null;
    const newItem: DeckItem = { ...item, id: randomUUID() };
    found.page.items.push(newItem);
    this.save();
    return newItem;
  }

  updateItem(deckId: string, pageId: string, itemId: string, updates: Partial<Omit<DeckItem, "id">>): DeckItem | null {
    const found = this.findPage(deckId, pageId);
    if (!found) return null;
    let item = found.page.items.find((i) => i.id === itemId);
    if (item) {
      Object.assign(item, updates);
      this.save();
      return item;
    }
    for (const group of found.page.groups) {
      item = group.items.find((i) => i.id === itemId);
      if (item) {
        Object.assign(item, updates);
        this.save();
        return item;
      }
    }
    return null;
  }

  removeItem(deckId: string, pageId: string, itemId: string): boolean {
    const found = this.findPage(deckId, pageId);
    if (!found) return false;
    const looseLen = found.page.items.length;
    found.page.items = found.page.items.filter((i) => i.id !== itemId);
    if (found.page.items.length < looseLen) {
      this.save();
      return true;
    }
    for (const group of found.page.groups) {
      const groupLen = group.items.length;
      group.items = group.items.filter((i) => i.id !== itemId);
      if (group.items.length < groupLen) {
        this.save();
        return true;
      }
    }
    return false;
  }

  addGroup(deckId: string, pageId: string, group: Omit<DeckGroup, "id" | "items">): DeckGroup | null {
    const found = this.findPage(deckId, pageId);
    if (!found) return null;
    const newGroup: DeckGroup = { ...group, id: randomUUID(), items: [] };
    found.page.groups.push(newGroup);
    this.save();
    return newGroup;
  }

  updateGroup(deckId: string, pageId: string, groupId: string, updates: Partial<Omit<DeckGroup, "id" | "items">>): DeckGroup | null {
    const found = this.findPage(deckId, pageId);
    if (!found) return null;
    const group = found.page.groups.find((g) => g.id === groupId);
    if (!group) return null;
    Object.assign(group, updates);
    this.save();
    return group;
  }

  removeGroup(deckId: string, pageId: string, groupId: string): boolean {
    const found = this.findPage(deckId, pageId);
    if (!found) return false;
    const group = found.page.groups.find((g) => g.id === groupId);
    if (!group) return false;
    found.page.items.push(...group.items);
    found.page.groups = found.page.groups.filter((g) => g.id !== groupId);
    this.save();
    return true;
  }

  moveItemToGroup(deckId: string, pageId: string, itemId: string, groupId: string): boolean {
    const found = this.findPage(deckId, pageId);
    if (!found) return false;
    const group = found.page.groups.find((g) => g.id === groupId);
    if (!group) return false;
    const itemIdx = found.page.items.findIndex((i) => i.id === itemId);
    if (itemIdx === -1) return false;
    const [item] = found.page.items.splice(itemIdx, 1);
    item.col = item.col - group.col;
    item.row = item.row - group.row;
    group.items.push(item);
    this.save();
    return true;
  }

  moveItemOutOfGroup(deckId: string, pageId: string, itemId: string, groupId: string): boolean {
    const found = this.findPage(deckId, pageId);
    if (!found) return false;
    const group = found.page.groups.find((g) => g.id === groupId);
    if (!group) return false;
    const itemIdx = group.items.findIndex((i) => i.id === itemId);
    if (itemIdx === -1) return false;
    const [item] = group.items.splice(itemIdx, 1);
    item.col = item.col + group.col;
    item.row = item.row + group.row;
    found.page.items.push(item);
    this.save();
    return true;
  }

  updateEndpointTargets(endpointId: string, host: string, port: number): number {
    let count = 0;
    for (const deck of this.decks) {
      for (const page of deck.pages) {
        for (const item of page.items) {
          if (item.oscTargetEndpointId === endpointId) {
            item.oscTarget = { host, port };
            count++;
          }
        }
        for (const group of page.groups) {
          for (const item of group.items) {
            if (item.oscTargetEndpointId === endpointId) {
              item.oscTarget = { host, port };
              count++;
            }
          }
        }
      }
    }
    if (count > 0) this.save();
    return count;
  }
}
