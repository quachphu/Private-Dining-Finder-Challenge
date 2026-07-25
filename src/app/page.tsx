import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/workspace";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "@/components/trust-badge";
import MapView from "@/components/map-view-loader";
import { ArrowRight, MapPinned, ShieldCheck, UtensilsCrossed, Users } from "lucide-react";

const FEATURES = [
  {
    icon: MapPinned,
    title: "Search by address",
    description: "Enter any office, headcount, and max commute — walking or driving.",
  },
  {
    icon: ShieldCheck,
    title: "Trust-labeled results",
    description: "Every capacity and price figure is marked verified, likely, or needs a call.",
  },
  {
    icon: Users,
    title: "Shared with your team",
    description: "One workspace code. Everyone sees the same saved offices and shortlist.",
  },
];

// Real output from an actual search: "50 people near Times Square, New
// York, NY" (one of the required scenarios), run through the real
// geocoding + commute + ranking pipeline via `npm run test:scenarios`.
// Every name, coordinate, minute figure, capacity, and trust label below
// is what the app actually returned for that one address — nothing
// invented — and the map below renders the real MapView component (same
// one used in the live app), not an image or illustration.
const PREVIEW_ORIGIN = { lat: 40.757, lng: -73.986, label: "Times Square, New York, NY" };
const MOCK_CARDS = [
  { id: "dos-caminos", name: "Dos Caminos", image: "/DosCaminos.jpg", lat: 40.7592, lng: -73.9853, commuteMinutes: 4, capacity: 50, trust: "verified" as const },
  { id: "carmines", name: "Carmine's Italian", image: "/CarminesItalian.png", lat: 40.7575, lng: -73.9867, commuteMinutes: 1, capacity: 200, trust: "verified" as const },
  { id: "aperibar", name: "AperiBar", image: "/AperiBar.jpg", lat: 40.7544, lng: -73.9858, commuteMinutes: 5, capacity: 75, trust: "likely" as const },
  { id: "renaissance-nyts", name: "Renaissance NYTS", image: "/RenaissanceNYTS.jpg", lat: 40.7595, lng: -73.9848, commuteMinutes: 5, capacity: 120, trust: "likely" as const },
];

export default async function LandingPage() {
  const company = await getCurrentCompany();
  if (company) redirect("/search");

  return (
    <div className="relative overflow-x-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [background-image:radial-gradient(circle,color-mix(in_oklch,var(--foreground),transparent_92%)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black_40%,transparent_100%)]"
      />

      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 lg:px-10">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
              <UtensilsCrossed className="size-3.5" />
            </span>
            <span className="font-semibold tracking-tight">Private Dining Finder</span>
          </div>
          <Link href="/start" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Get started
          </Link>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-[100rem] flex-col items-center px-6 py-20 text-center sm:py-28 lg:px-10">
        <Badge variant="outline" className="mb-6 gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          For corporate event planners
        </Badge>
        <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
          Find the right private dining venue in minutes, not calls.
        </h1>
        <p className="mt-6 max-w-xl text-balance text-muted-foreground sm:text-lg">
          Enter an address, headcount, and commute window. Get a ranked, map-based shortlist of private dining
          venues — every capacity and price figure labeled by how confident we actually are in it.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link href="/start" className={buttonVariants({ size: "lg", className: "gap-1.5 px-6" })}>
            Get started
            <ArrowRight className="size-4" />
          </Link>
          <span className="text-xs text-muted-foreground">Free to use · No account or card required</span>
        </div>

        {/* Illustrative product preview — a simplified mock of the actual
            search-results layout (list + map) — real output from a real
            search, not a literal screenshot. */}
        <div className="mt-16 w-full overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-foreground/10">
          <div className="flex items-center gap-1.5 border-b bg-muted/40 px-5 py-3.5">
            <span className="size-2.5 rounded-full bg-red-400/70" />
            <span className="size-2.5 rounded-full bg-amber-400/70" />
            <span className="size-2.5 rounded-full bg-emerald-400/70" />
            <div className="ml-3 flex-1 rounded-md bg-background px-3 py-1.5 text-left text-xs text-muted-foreground">
              privatedining.app/search?address=Times+Square,+New+York,+NY&headcount=50
            </div>
          </div>
          <div className="grid gap-5 p-6 text-left sm:grid-cols-[1fr_340px] lg:p-8">
            <div className="grid gap-5 sm:grid-cols-2">
              {MOCK_CARDS.map((card, i) => (
                <div key={card.id} className="rounded-xl border bg-background p-4">
                  <div className="relative h-48 overflow-hidden rounded-lg bg-muted lg:h-56">
                    <Image src={card.image} alt={card.name} fill sizes="340px" className="object-cover" />
                  </div>
                  <div className="mt-3 truncate text-sm font-medium">
                    {i + 1}. {card.name}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {card.commuteMinutes} min · Fits {card.capacity}
                    </span>
                    <TrustBadge level={card.trust} className="text-xs" />
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden min-h-[500px] overflow-hidden rounded-xl sm:block lg:min-h-[600px]">
              <MapView
                className="pointer-events-none h-full w-full"
                origin={PREVIEW_ORIGIN}
                venues={MOCK_CARDS.map((card, i) => ({
                  id: card.id,
                  name: card.name,
                  lat: card.lat,
                  lng: card.lng,
                  rank: i + 1,
                  commuteMinutes: card.commuteMinutes,
                  capacity: card.capacity,
                  trustLevel: card.trust,
                }))}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="border-t bg-card/50">
        <div className="mx-auto grid max-w-5xl gap-10 px-6 py-16 sm:grid-cols-3 lg:px-10 lg:py-20">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col items-start gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
                <f.icon className="size-4" />
              </span>
              <div>
                <div className="font-medium">{f.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{f.description}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
