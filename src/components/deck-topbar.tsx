"use client";

import { useState } from "react";
import type { Deck, DeckPage } from "@/lib/types";

interface DeckTopbarProps {
  decks: Deck[];
  activeDeck: Deck | null;
  activePage: DeckPage | null;
  editMode: boolean;
  onSelectDeck: (id: string) => void;
  onSelectPage: (id: string) => void;
  onCreateDeck: (name: string) => void;
  onDeleteDeck: (id: string) => void;
  onRenameDeck: (id: string, name: string) => void;
  onCreatePage: (name: string) => void;
  onDeletePage: (id: string) => void;
  onRenamePage: (id: string, name: string) => void;
  onToggleEdit: () => void;
}

export function DeckTopbar({
  decks, activeDeck, activePage, editMode,
  onSelectDeck, onSelectPage,
  onCreateDeck, onDeleteDeck, onRenameDeck,
  onCreatePage, onDeletePage, onRenamePage,
  onToggleEdit,
}: DeckTopbarProps) {
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [editPageName, setEditPageName] = useState("");

  const handleNewDeck = () => {
    const name = prompt("New deck name:");
    if (name?.trim()) onCreateDeck(name.trim());
  };

  const handleNewPage = () => {
    const name = prompt("New page name:");
    if (name?.trim()) onCreatePage(name.trim());
  };

  const handlePageDoubleClick = (page: DeckPage) => {
    if (!editMode) return;
    setEditingPageId(page.id);
    setEditPageName(page.name);
  };

  const handlePageRename = (pageId: string) => {
    if (editPageName.trim()) {
      onRenamePage(pageId, editPageName.trim());
    }
    setEditingPageId(null);
  };

  const handlePageContextMenu = (e: React.MouseEvent, page: DeckPage) => {
    if (!editMode) return;
    e.preventDefault();
    if (confirm(`Delete page "${page.name}"?`)) {
      onDeletePage(page.id);
    }
  };

  return (
    <div className="px-5 py-3 border-b border-white/5 flex items-center gap-3">
      <select
        value={activeDeck?.id ?? ""}
        onChange={(e) => {
          if (e.target.value === "__new__") handleNewDeck();
          else onSelectDeck(e.target.value);
        }}
        className="bg-surface-lighter border border-white/10 text-white px-3 py-1.5 rounded-lg text-xs focus:outline-none focus:border-accent/50"
      >
        {decks.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
        <option value="__new__">+ New Deck</option>
      </select>

      {editMode && activeDeck && (
        <>
          <button
            onClick={() => {
              const name = prompt("Rename deck:", activeDeck.name);
              if (name?.trim()) onRenameDeck(activeDeck.id, name.trim());
            }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            rename
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete deck "${activeDeck.name}"?`)) onDeleteDeck(activeDeck.id);
            }}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors"
          >
            delete
          </button>
        </>
      )}

      <div className="w-px h-5 bg-white/10" />

      <div className="flex gap-1">
        {activeDeck?.pages.map((page) => (
          <button
            key={page.id}
            onClick={() => onSelectPage(page.id)}
            onDoubleClick={() => handlePageDoubleClick(page)}
            onContextMenu={(e) => handlePageContextMenu(e, page)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              activePage?.id === page.id
                ? "bg-accent/10 text-accent border border-accent/20"
                : "bg-white/3 text-gray-500 border border-white/5 hover:text-gray-300"
            }`}
          >
            {editingPageId === page.id ? (
              <input
                type="text"
                value={editPageName}
                onChange={(e) => setEditPageName(e.target.value)}
                onBlur={() => handlePageRename(page.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePageRename(page.id);
                  if (e.key === "Escape") setEditingPageId(null);
                }}
                autoFocus
                className="bg-transparent border-none outline-none w-16 text-xs"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              page.name
            )}
          </button>
        ))}
        <button
          onClick={handleNewPage}
          className="px-2 py-1 text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          +
        </button>
      </div>

      <div className="flex-1" />

      <button
        onClick={onToggleEdit}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          editMode
            ? "bg-accent/20 text-accent border border-accent/30"
            : "bg-white/3 border border-white/10 text-gray-400 hover:text-gray-200"
        }`}
      >
        {editMode ? "Done Editing" : "Edit Mode"}
      </button>
    </div>
  );
}
