"use client";

import { useEffect, useId, useRef, useState } from "react";

type Option = { id: string; label: string };

export default function SearchPicker({
  label, kind, city, societyId, wing, floor,
  selected, onSelect, disabled,
}: {
  label: string;
  kind: "societies" | "wings" | "floors" | "flats";
  city?: string;
  societyId?: string;
  wing?: string;
  floor?: string;
  selected: Option | null;
  onSelect: (option: Option | null) => void;
  disabled: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const latestQuery = useRef("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const minimum = kind === "societies" || kind === "flats" ? 1 : 0;
  const enough = query.trim().length >= minimum;

  useEffect(() => {
    if (!open || disabled || selected || !enough) return;
    const controller = new AbortController();
    const requestedQuery = query;
    const timer = window.setTimeout(async () => {
      setMessage("Searching…");
      try {
        const params = new URLSearchParams({ kind, search: query.trim() });
        if (city) params.set("city", city);
        if (societyId) params.set("societyId", societyId);
        if (wing !== undefined) params.set("wing", wing);
        if (floor !== undefined) params.set("floor", floor);

        const response = await fetch(`/api/resident/onboarding?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.message ?? "Search failed. Close and reopen the field to retry.");
        }
        if (controller.signal.aborted || latestQuery.current !== requestedQuery) return;

        const options: Option[] = Array.isArray(body.items)
          ? body.items.filter((item: unknown): item is Option =>
              typeof item === "object" && item !== null &&
              "id" in item && typeof item.id === "string" &&
              "label" in item && typeof item.label === "string")
          : [];

        setItems(options);
        setActive(-1);
        setMessage(options.length
          ? `${options.length} suggestions. Select one to continue.`
          : kind === "societies"
            ? "No matching approved society in this city."
            : "No matches. Try another search.");
      } catch (error) {
        if (!controller.signal.aborted && latestQuery.current === requestedQuery) {
          setItems([]);
          setMessage(error instanceof Error ? error.message : "Search failed.");
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    open, disabled, selected, enough, query, kind,
    city, societyId, wing, floor, retry,
  ]);

  function choose(item: Option) {
    onSelect(item);
    setOpen(false);
    setItems([]);
    setActive(-1);
    setMessage("");
  }

  function highlight(index: number) {
    setActive(index);
    requestAnimationFrame(() => {
      document.getElementById(`${id}-option-${index}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  return (
    <div className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}>
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {selected ? (
        <div className="mt-2 flex min-h-12 items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3">
          <span className="min-w-0 break-words text-sm font-medium">{selected.label}</span>
          <button type="button" disabled={disabled}
            className="min-h-11 shrink-0 px-2 text-xs font-semibold text-emerald-800 hover:underline"
            onClick={() => {
              onSelect(null);
              latestQuery.current = "";
              setQuery(""); setItems([]); setActive(-1);
              setMessage(""); setOpen(true);
              requestAnimationFrame(() => input.current?.focus());
            }}>Change</button>
        </div>
      ) : (
        <>
          <input ref={input} id={id} role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && enough}
            aria-controls={`${id}-list`}
            aria-describedby={`${id}-help`}
            aria-activedescendant={open && active >= 0
              ? `${id}-option-${active}` : undefined}
            value={query} disabled={disabled}
            maxLength={100} autoComplete="off"
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 focus:border-emerald-700 focus:outline-2 focus:outline-emerald-700"
            placeholder={
              kind === "societies" ? "Start typing your society name"
              : kind === "wings" ? "Choose or search wing"
              : kind === "floors" ? "Choose or search floor"
              : "Full flat number, e.g. 2004"
            }
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              const value = event.target.value;
              latestQuery.current = value;
              setQuery(value); setItems([]); setActive(-1);
              setMessage(""); setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault(); setOpen(false);
              } else if (event.key === "ArrowDown") {
                event.preventDefault(); setOpen(true);
                if (items.length) highlight(Math.min(active + 1, items.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault(); setOpen(true);
                if (items.length) highlight(active <= 0 ? items.length - 1 : active - 1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (open && active >= 0 && items[active]) choose(items[active]);
              }
            }} />
          <p id={`${id}-help`} className="mt-1 text-xs text-slate-500">
            {kind === "societies"
              ? "Search by any words in the society name."
              : kind === "flats"
                ? "Use the full flat number, e.g. 2004."
                : "Select an option from your society's registered layout."}
          </p>
          {open && enough && (
            <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              <ul id={`${id}-list`} role="listbox" aria-label={`${label} suggestions`}
                className="max-h-60 overflow-y-auto py-1">
                {items.map((item, index) => (
                  <li key={item.id} id={`${id}-option-${index}`}
                    role="option" aria-selected={index === active}
                    className={`cursor-pointer px-4 py-3 text-sm ${
                      index === active ? "bg-emerald-50 text-emerald-950" : "hover:bg-slate-50"
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(item)}>
                    {item.label}
                  </li>
                ))}
              </ul>
              {!items.length && (
                <div className="px-4 py-3 text-sm text-slate-600">
                  <p role="status">{message || "Searching…"}</p>
                  {message && <button type="button"
                    className="mt-2 font-semibold text-emerald-800 underline"
                    onClick={() => setRetry((value) => value + 1)}>Search again</button>}
                </div>
              )}
            </div>
          )}
          <span className="sr-only" role="status">{message}</span>
        </>
      )}
    </div>
  );
}
