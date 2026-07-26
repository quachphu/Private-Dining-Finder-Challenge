import Link from "next/link";
import { UtensilsCrossed } from "lucide-react";
import { getCurrentCompany } from "@/lib/workspace";
import { leaveWorkspaceAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { NavLinks } from "@/components/nav-links";

export async function NavBar() {
  const company = await getCurrentCompany();
  if (!company) return null;

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl border border-foreground/[0.06] bg-background/70 px-4 py-2.5 shadow-sm backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/search" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
              <UtensilsCrossed className="size-3.5" />
            </span>
            <span className="hidden sm:inline">Private Dining Finder</span>
          </Link>
          <NavLinks />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="hidden text-right leading-tight sm:block">
            <div className="font-medium">
              {company.name}
              {company.created_by && <span className="font-normal text-muted-foreground"> · organized by {company.created_by}</span>}
            </div>
            <div className="text-muted-foreground">
              code: <code className="rounded bg-muted px-1 py-0.5">{company.code}</code>
            </div>
          </div>
          <form action={leaveWorkspaceAction}>
            <Button type="submit" variant="ghost" size="sm">
              Switch workspace
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
