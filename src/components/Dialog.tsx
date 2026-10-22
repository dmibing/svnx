import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export default function Dialog({
  title,
  subtitle,
  wide,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (
        [...document.querySelectorAll('[role="dialog"]')].at(-1) !== ref.current
      )
        return;
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const nodes = [
          ...ref.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
          ),
        ].filter((n) => n.offsetParent !== null);
        if (!nodes.length) {
          e.preventDefault();
          return;
        }
        const first = nodes[0],
          last = nodes.at(-1)!;
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
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
      previous?.focus();
    };
  }, [onClose, busy]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <header>
          <div>
            {subtitle && <span className="section-eyebrow">{subtitle}</span>}
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            title="关闭弹窗"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
