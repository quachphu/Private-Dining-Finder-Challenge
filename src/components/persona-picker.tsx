import Link from "next/link";
import { PERSONA_IDS, PERSONAS, type PersonaId } from "@/lib/personas";
import { cn } from "@/lib/utils";

/**
 * Links rather than a client-side toggle: the selection lives in the URL, which
 * means it survives a refresh, can be shared with a colleague, and needs no
 * client JavaScript. Switching persona intentionally drops the current search
 * params so the new defaults are actually visible — keeping them would make the
 * pills look like they do nothing.
 */
export function PersonaPicker({ selected }: { selected: PersonaId | null }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">Planning as</span>
        {PERSONA_IDS.map((id) => {
          const isSelected = selected === id;
          return (
            <Link
              key={id}
              href={isSelected ? "/search" : `/search?persona=${id}`}
              aria-pressed={isSelected}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                isSelected
                  ? "border-foreground bg-foreground text-background"
                  : "text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              )}
            >
              {PERSONAS[id].label}
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {selected
          ? `${PERSONAS[selected].hint} Sets the starting values below — change any of them freely.`
          : "Optional. Sets sensible starting values in the form below; it never filters or reorders results."}
      </p>
    </div>
  );
}
