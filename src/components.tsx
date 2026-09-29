import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { Card } from "../shared/types.ts";
import { rankText, suitText } from "../shared/cards.ts";

export function CardFace({
  card,
  small = false,
  wild = false,
  as,
  selected = false,
  onDown,
  onKeyboard,
  index,
  fromBottom = false,
}: {
  card: Card;
  small?: boolean;
  wild?: boolean;
  as?: number;
  selected?: boolean;
  onDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyboard?: () => void;
  index?: number;
  fromBottom?: boolean;
}) {
  const red = card.suit === "H" || card.suit === "D" || card.rank === 17;
  const content = (
    <>
      <span className="card-corner">
        <b>{card.rank >= 16 ? "★" : rankText(card.rank)}</b>
        <span>
          {card.rank >= 16
            ? card.rank === 17
              ? "大"
              : "小"
            : suitText[card.suit]}
        </span>
      </span>
      <span className={`card-mark ${card.rank >= 16 ? "joker-mark" : ""}`}>
        {card.rank >= 16 ? "✦" : suitText[card.suit]}
      </span>
      <span className="card-corner reverse">
        <b>{card.rank >= 16 ? "★" : rankText(card.rank)}</b>
        <span>
          {card.rank >= 16
            ? card.rank === 17
              ? "大"
              : "小"
            : suitText[card.suit]}
        </span>
      </span>
      {wild && (
        <span className="wild-badge">
          {as && as !== card.rank ? "→" + rankText(as) : "癞"}
        </span>
      )}
    </>
  );
  const label = `${card.rank >= 16 ? "" : suitText[card.suit]}${rankText(card.rank)}${wild ? " 癞子" : ""}${as && as !== card.rank ? " 作为" + rankText(as) : ""}`;
  const props = {
    className: `playing-card ${red ? "red" : "black"} ${small ? "small" : ""} ${selected ? "selected" : ""} ${wild ? "is-wild" : ""} ${fromBottom ? "from-bottom" : ""}`,
    style: { "--card-index": index ?? 0 } as CSSProperties,
    "aria-label": label,
  };
  return onDown ? (
    <button
      {...props}
      type="button"
      data-card={card.id}
      aria-pressed={selected}
      onPointerDown={onDown}
      onClick={(e) => {
        if (e.detail === 0) onKeyboard?.();
      }}
    >
      {content}
    </button>
  ) : (
    <div {...props} role="img">
      {content}
    </div>
  );
}

export function Hand({
  cards,
  selected,
  setSelected,
  wild,
  disabled = false,
  bottomIds = [],
}: {
  cards: Card[];
  selected: string[];
  setSelected: (s: string[]) => void;
  wild: number | null;
  disabled?: boolean;
  bottomIds?: string[];
}) {
  const drag = useRef<{ select: boolean; visited: Set<string> } | null>(null),
    current = useRef(selected);
  current.current = selected;
  const apply = (id: string) => {
    const d = drag.current;
    if (!d || d.visited.has(id)) return;
    d.visited.add(id);
    const next = d.select
      ? [...new Set([...current.current, id])]
      : current.current.filter((v) => v !== id);
    current.current = next;
    setSelected(next);
  };
  useEffect(() => {
    const end = () => {
      drag.current = null;
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);
  const rows =
    cards.length > 10
      ? [
          cards.slice(0, Math.ceil(cards.length / 2)),
          cards.slice(Math.ceil(cards.length / 2)),
        ]
      : [cards];
  return (
    <div
      className={`hand ${cards.length > 10 ? "two-rows" : ""}`}
      aria-label="你的手牌"
      onPointerMove={(e) => {
        if (drag.current) {
          const el = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest<HTMLElement>("[data-card]");
          if (el?.dataset.card) apply(el.dataset.card);
        }
      }}
    >
      {rows.map((row, ri) => (
        <div
          className="hand-row"
          key={ri}
          style={{ "--count": row.length } as CSSProperties}
        >
          {row.map((card, i) => (
            <CardFace
              key={card.id}
              card={card}
              wild={card.rank === wild}
              selected={selected.includes(card.id)}
              index={ri * 10 + i}
              fromBottom={bottomIds.includes(card.id)}
              onKeyboard={() =>
                setSelected(
                  selected.includes(card.id)
                    ? selected.filter((id) => id !== card.id)
                    : [...selected, card.id],
                )
              }
              onDown={(e) => {
                if (disabled || e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.focus({ preventScroll: true });
                drag.current = {
                  select: !selected.includes(card.id),
                  visited: new Set(),
                };
                apply(card.id);
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const id = useId(),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select, a[href], [tabindex="0"]',
        );
        if (!els?.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
      >
        <header className="modal-header">
          <h2 id={id}>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
