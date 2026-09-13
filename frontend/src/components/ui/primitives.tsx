import * as React from "react";
import { flushSync } from "react-dom";
import { cn } from "../../lib/cn";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost" | "danger" | "success";
  size?: "default" | "sm" | "icon";
};

export function Button({ className, variant = "primary", size = "default", type = "button", onClick, ...props }: ButtonProps) {
  const handleClick: React.MouseEventHandler<HTMLButtonElement> = event => {
    if (onClick) flushSync(() => onClick(event));
  };
  return <button type={type} className={cn("btn", `btn-${variant}`, size === "sm" && "btn-sm", size === "icon" && "btn-icon", className)} {...props} onClick={onClick ? handleClick : undefined} />;
}

/**
 * React's onChange plugin compares its value tracker before dispatching. A
 * script that assigns `input.value` through the DOM setter updates that
 * tracker too, so a following native `input` event can be ignored even though
 * the visible value changed. Listen to input once and expose the same callback
 * to existing callers; the change fallback covers controls/browsers that only
 * emit change. (bug: native OCR/create harness input left the controlled draft
 * stale, while real typing appeared to work.)
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, onInput, onChange, ...props }, ref) => {
  const lastInputValue = React.useRef<string | null>(null);
  const handleInput: React.FormEventHandler<HTMLInputElement> = event => {
    lastInputValue.current = event.currentTarget.value;
    flushSync(() => {
      onInput?.(event);
      onChange?.(event as React.ChangeEvent<HTMLInputElement>);
    });
  };
  const handleChange: React.ChangeEventHandler<HTMLInputElement> = event => {
    if (lastInputValue.current === event.currentTarget.value) {
      lastInputValue.current = null;
      return;
    }
    lastInputValue.current = null;
    flushSync(() => onChange?.(event));
  };
  return <input ref={ref} className={cn("input", className)} {...props} onInput={handleInput} onChange={onChange ? handleChange : undefined} />;
});
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("input textarea", className)} {...props} />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("field-label", className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("card", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("card-title", className)} {...props} />;
}

export function Badge({ className, tone = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "danger" | "accent" }) {
  return <span className={cn("badge", `badge-${tone}`, className)} {...props} />;
}

export function Alert({ className, tone = "info", ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: "info" | "danger" | "success" }) {
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("alert", `alert-${tone}`, className)} {...props} />;
}

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn("separator", className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("skeleton", className)} {...props} />;
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Memuat" />;
}

export function Switch({ checked, onCheckedChange, id, label }: { checked: boolean; onCheckedChange: (checked: boolean) => void; id?: string; label?: string }) {
  return <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} className={cn("switch", checked && "is-on")} onClick={() => onCheckedChange(!checked)}><span aria-hidden="true" /></button>;
}

export function Checkbox({ checked, onCheckedChange, id, label }: { checked: boolean; onCheckedChange: (checked: boolean) => void; id?: string; label?: React.ReactNode }) {
  return <label className="check-label"><input id={id} type="checkbox" checked={checked} onChange={event => onCheckedChange(event.target.checked)} /><span>{label}</span></label>;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("input select", className)} {...props} />;
}

export function Dialog({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const nodes = [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return <div className="sheet-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panelRef} className="sheet" role="document">
      <div className="sheet-handle" aria-hidden="true" />
      <h2 id={titleId} className="sheet-title">{title}</h2>
      {description && <p id={descriptionId} className="sheet-sub">{description}</p>}
      {children}
    </div>
  </div>;
}