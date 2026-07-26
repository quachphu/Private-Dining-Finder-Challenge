import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/workspace";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrustBadge } from "@/components/trust-badge";
import MapView from "@/components/map-view-loader";
import { formatGeneratedAt, getLandingPreview, PREVIEW_QUERY } from "@/lib/landing-preview";
import { isPlaceholderPhoto } from "@/lib/photos";
import { ArrowRight, MapPinned, ShieldCheck, UtensilsCrossed, Users } from "lucide-react";

function PreviewFrame({ children, caption }: { children: React.ReactNode; caption?: React.ReactNode }) {
  const url = `privatedining.app/search?address=${encodeURIComponent(PREVIEW_QUERY.address)}&headcount=${PREVIEW_QUERY.headcount}&maxCommuteMinutes=${PREVIEW_QUERY.maxCommuteMinutes}&commuteMode=${PREVIEW_QUERY.commuteMode}`;

  return (
    <div className="mt-16 w-full">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-foreground/10">
        <div className="flex items-center gap-1.5 border-b bg-muted/40 px-5 py-3.5">
          <span className="size-2.5 rounded-full bg-red-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
          <div className="ml-3 flex-1 truncate rounded-md bg-background px-3 py-1.5 text-left text-xs text-muted-foreground">
            {url}
          </div>
        </div>
        {children}
      </div>
      {caption && <p className="mt-3 text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="grid gap-5 p-6 text-left sm:grid-cols-[1fr_340px] lg:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-background p-4">
            <Skeleton className="h-48 w-full rounded-lg lg:h-56" />
            <Skeleton className="mt-3 h-4 w-2/3" />
            <Skeleton className="mt-2 h-4 w-1/2" />
          </div>
        ))}
      </div>
      <Skeleton className="hidden min-h-[500px] rounded-xl sm:block lg:min-h-[600px]" />
    </div>
  );
}

/**
 * Runs the first required scenario for real, on the same pipeline a signed-in
 * planner uses, and renders whatever it actually returned.
 *
 * If it returns nothing (cold cache with no network, database unreachable), the
 * preview says so instead of falling back to invented cards — the same
 * fails-honestly rule the search results themselves follow.
 */
async function LivePreview() {
  const preview = await getLandingPreview();

  if (!preview) {
    return (
      <PreviewFrame>
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 p-10 text-center">
          <p className="text-sm font-medium">Live preview unavailable right now</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            This panel runs a real search when it loads rather than showing a canned screenshot, so it goes quiet if the
            pipeline can&apos;t reach its data sources.
          </p>
        </div>
      </PreviewFrame>
    );
  }

  const estimated = preview.cards.some((c) => c.commuteEstimated);

  return (
    <PreviewFrame
      caption={
        <>
          A real search, not a screenshot: {PREVIEW_QUERY.headcount} guests near {preview.origin.label}, under{" "}
          {PREVIEW_QUERY.maxCommuteMinutes} minutes by car. Ranked and labeled by the live pipeline on{" "}
          {formatGeneratedAt(preview.generatedAt)} UTC
          {estimated && " · commute times shown are straight-line estimates"}.
        </>
      }
    >
      <div className="grid gap-5 p-6 text-left sm:grid-cols-[1fr_340px] lg:p-8">
        <div className="grid gap-5 sm:grid-cols-2">
          {preview.cards.map((card, i) => (
            <div key={card.id} className="rounded-xl border bg-background p-4">
              <div className="relative h-48 overflow-hidden rounded-lg bg-muted lg:h-56">
                {card.photoUrl ? (
                  <>
                    <Image src={card.photoUrl} alt={card.name} fill sizes="340px" className="object-cover" unoptimized />
                    {isPlaceholderPhoto(card.photoUrl) && (
                      <span className="absolute bottom-1.5 left-1.5 rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        Placeholder image
                      </span>
                    )}
                  </>
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No photo found
                  </span>
                )}
              </div>
              <div className="mt-3 truncate text-sm font-medium">
                {i + 1}. {card.name}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {card.commuteMinutes} min · Fits {card.capacity}
                </span>
                <TrustBadge level={card.capacityTrust} subject="Capacity" className="text-xs" />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {card.priceLabel}
                </span>
                <TrustBadge level={card.priceTrust} subject="Price" className="text-xs" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden min-h-[500px] overflow-hidden rounded-xl sm:block lg:min-h-[600px]">
          <MapView
            className="pointer-events-none h-full w-full"
            origin={preview.origin}
            venues={preview.cards.map((card, i) => ({
              id: card.id,
              name: card.name,
              lat: card.lat,
              lng: card.lng,
              rank: i + 1,
              commuteMinutes: card.commuteMinutes,
              capacity: card.capacity,
              trustLevel: card.capacityTrust,
            }))}
          />
        </div>
      </div>
    </PreviewFrame>
  );
}

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

        {/* Streamed separately from the hero: this runs a real search against
            the live pipeline, so it must never delay first paint. */}
        <Suspense fallback={<PreviewFrame>{<PreviewSkeleton />}</PreviewFrame>}>
          <LivePreview />
        </Suspense>
      </section>

      <section className="border-t bg-card/50" id="features">
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
