"use client";

interface DeckToolbarProps {
  placingType: string | null;
  onStartPlace: (type: "button" | "slider" | "xy-pad" | "group") => void;
  onCancelPlace: () => void;
}

export function DeckToolbar({ placingType, onStartPlace, onCancelPlace }: DeckToolbarProps) {
  const items = [
    { type: "button" as const, label: "+ Button" },
    { type: "slider" as const, label: "+ Slider" },
    { type: "xy-pad" as const, label: "+ XY Pad" },
    { type: "group" as const, label: "+ Group" },
  ];

  return (
    <div className="px-5 py-2 border-b border-white/5 flex items-center gap-2 bg-surface-light/50">
      {placingType && (
        <span className="text-xs text-accent mr-2">
          Click an empty cell to place {placingType}
        </span>
      )}
      {items.map((item) => (
        <button
          key={item.type}
          onClick={() =>
            placingType === item.type ? onCancelPlace() : onStartPlace(item.type)
          }
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            placingType === item.type
              ? "bg-accent text-surface"
              : "bg-surface-lighter border border-white/10 text-gray-400 hover:text-gray-200"
          }`}
        >
          {item.label}
        </button>
      ))}
      {placingType && (
        <button
          onClick={onCancelPlace}
          className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
