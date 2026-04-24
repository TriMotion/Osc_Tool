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
  const [creatingDeck, setCreatingDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [creatingPage, setCreatingPage] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [renamingDeck, setRenamingDeck] = useState(false);
  const [renameDeckName, setRenameDeckName] = useState("");
  const [confirmDeleteDeck, setConfirmDeleteDeck] = useState(false);
  const [confirmDeletePageId, setConfirmDeletePageId] = useState<string | null>(null);

  const handleCreateDeck = () => {
    if (newDeckName.trim()) {
      onCreateDeck(newDeckName.trim());
      setNewDeckName("");
      setCreatingDeck(false);
    }
  };

  const handleCreatePage = () => {
    if (newPageName.trim()) {
      onCreatePage(newPageName.trim());
      setNewPageName("");
      setCreatingPage(false);
    }
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

  const handleStartRenameDeck = () => {
    if (!activeDeck) return;
    setRenameDeckName(activeDeck.name);
    setRenamingDeck(true);
  };

  const handleRenameDeck = () => {
    if (renameDeckName.trim() && activeDeck) {
      onRenameDeck(activeDeck.id, renameDeckName.trim());
    }
    setRenamingDeck(false);
  };

  return (
    <div className="px-5 py-3 border-b border-white/5 flex items-center gap-3">
      {creatingDeck ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={newDeckName}
            onChange={(e) => setNewDeckName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateDeck();
              if (e.key === "Escape") setCreatingDeck(false);
            }}
            placeholder="Deck name..."
            autoFocus
            className="bg-black border border-deck/30 rounded-lg px-2 py-1 text-xs w-32 focus:outline-none"
          />
          <button onClick={handleCreateDeck} className="text-xs text-deck">ok</button>
          <button onClick={() => setCreatingDeck(false)} className="text-xs text-gray-500">x</button>
        </div>
      ) : renamingDeck ? (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={renameDeckName}
            onChange={(e) => setRenameDeckName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameDeck();
              if (e.key === "Escape") setRenamingDeck(false);
            }}
            autoFocus
            className="bg-black border border-deck/30 rounded-lg px-2 py-1 text-xs w-32 focus:outline-none"
          />
          <button onClick={handleRenameDeck} className="text-xs text-deck">ok</button>
          <button onClick={() => setRenamingDeck(false)} className="text-xs text-gray-500">x</button>
        </div>
      ) : (
        <select
          value={activeDeck?.id ?? ""}
          onChange={(e) => {
            if (e.target.value === "__new__") {
              setCreatingDeck(true);
              setNewDeckName("");
            } else {
              onSelectDeck(e.target.value);
            }
          }}
          className="bg-elevated border border-white/10 text-white px-3 py-1.5 rounded-lg text-xs focus:outline-none focus:border-deck/18"
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
          <option value="__new__">+ New Deck</option>
        </select>
      )}

      {editMode && activeDeck && !creatingDeck && !renamingDeck && (
        confirmDeleteDeck ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-red-400">Delete deck &quot;{activeDeck.name}&quot;?</span>
            <button onClick={() => { onDeleteDeck(activeDeck.id); setConfirmDeleteDeck(false); }}
              className="text-xs text-red-400 font-medium hover:text-red-300">yes</button>
            <button onClick={() => setConfirmDeleteDeck(false)}
              className="text-xs text-gray-500 hover:text-gray-300">no</button>
          </div>
        ) : (
          <>
            <button onClick={handleStartRenameDeck}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
              rename
            </button>
            <button onClick={() => setConfirmDeleteDeck(true)}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors">
              delete deck
            </button>
          </>
        )
      )}

      <div className="w-px h-5 bg-white/10" />

      <div className="flex gap-1 items-center">
        {activeDeck?.pages.map((page) => (
          <div key={page.id} className="flex items-center gap-0.5">
            {confirmDeletePageId === page.id ? (
              <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-md">
                <span className="text-[10px] text-red-400">Delete?</span>
                <button onClick={() => { onDeletePage(page.id); setConfirmDeletePageId(null); }}
                  className="text-[10px] text-red-400 font-medium hover:text-red-300">yes</button>
                <button onClick={() => setConfirmDeletePageId(null)}
                  className="text-[10px] text-gray-500 hover:text-gray-300">no</button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => onSelectPage(page.id)}
                  onDoubleClick={() => handlePageDoubleClick(page)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    activePage?.id === page.id
                      ? "bg-deck/10 text-deck border border-deck/20"
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
                {editMode && activeDeck.pages.length > 1 && (
                  <button
                    onClick={() => setConfirmDeletePageId(page.id)}
                    className="text-[10px] text-gray-600 hover:text-red-400 transition-colors px-0.5"
                  >
                    x
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        {creatingPage ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePage();
                if (e.key === "Escape") setCreatingPage(false);
              }}
              placeholder="Page name..."
              autoFocus
              className="bg-black border border-deck/30 rounded px-2 py-0.5 text-xs w-20 focus:outline-none"
            />
            <button onClick={handleCreatePage} className="text-xs text-deck">ok</button>
            <button onClick={() => setCreatingPage(false)} className="text-xs text-gray-500">x</button>
          </div>
        ) : (
          <button
            onClick={() => { setCreatingPage(true); setNewPageName(""); }}
            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            +
          </button>
        )}
      </div>

      <div className="flex-1" />

      <button
        onClick={onToggleEdit}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          editMode
            ? "bg-deck/20 text-deck border border-deck/30"
            : "bg-white/3 border border-white/10 text-gray-400 hover:text-gray-200"
        }`}
      >
        {editMode ? "Done Editing" : "Edit Mode"}
      </button>
    </div>
  );
}
