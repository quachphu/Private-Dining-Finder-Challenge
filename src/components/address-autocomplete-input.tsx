"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AddressSuggestion } from "@/app/api/geocode-suggest/route";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;

export function AddressAutocompleteInput({
  id,
  name,
  form,
  placeholder,
  defaultValue,
  value,
  onValueChange,
  required,
  autoFocus,
  className,
}: {
  id?: string;
  name?: string;
  form?: string;
  placeholder?: string;
  defaultValue?: string;
  /** Pass for controlled usage (parent owns the value); omit for uncontrolled. */
  value?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const isControlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? "");
  const inputValue = isControlled ? value : uncontrolledValue;
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextFetch = useRef(false);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function fetchSuggestions(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode-suggest?q=${encodeURIComponent(query)}`);
        const data: AddressSuggestion[] = await res.json();
        setSuggestions(data);
        setOpen(data.length > 0);
        setHighlighted(-1);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, DEBOUNCE_MS);
  }

  function handleChange(next: string) {
    if (!isControlled) setUncontrolledValue(next);
    onValueChange?.(next);
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    fetchSuggestions(next);
  }

  function selectSuggestion(s: AddressSuggestion) {
    skipNextFetch.current = true;
    if (!isControlled) setUncontrolledValue(s.label);
    onValueChange?.(s.label);
    setOpen(false);
    setSuggestions([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlighted >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        form={form}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        autoComplete="off"
        value={inputValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={className}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {suggestions.map((s, i) => (
            <button
              key={`${s.lat}-${s.lng}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
              className={cn(
                "block w-full truncate px-3 py-2 text-left text-sm transition-colors duration-100 hover:bg-muted",
                i === highlighted && "bg-muted"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
