import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/workspace";
import { joinOrCreateWorkspaceAction } from "@/app/actions";
import { CreateWorkspaceWizard } from "@/components/create-workspace-wizard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPinned, ShieldCheck, UtensilsCrossed, Users } from "lucide-react";

const FEATURES = [
  { icon: MapPinned, title: "Search by address", description: "Any office, headcount, and max commute." },
  { icon: ShieldCheck, title: "Trust-labeled results", description: "Verified, likely, or needs a call — always labeled." },
  { icon: Users, title: "Shared with your team", description: "One code, same saved offices and shortlist for everyone." },
];

export default async function StartPage() {
  const company = await getCurrentCompany();
  if (company) redirect("/search");

  return (
    <div className="relative flex min-h-[calc(100vh-0px)] items-center justify-center overflow-hidden bg-background px-4 py-12 sm:px-6 lg:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [background-image:radial-gradient(circle,color-mix(in_oklch,var(--foreground),transparent_92%)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,black_40%,transparent_100%)]"
      />

      <div className="w-full max-w-5xl">
        <Link
          href="/"
          className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Link>

        <div className="grid overflow-hidden rounded-2xl border shadow-sm lg:grid-cols-[1fr_1.1fr]">
          <div className="hidden flex-col justify-between gap-10 bg-foreground p-10 text-background lg:flex xl:p-12">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-background/10">
                <UtensilsCrossed className="size-4.5" />
              </span>
              <span className="font-semibold tracking-tight">Private Dining Finder</span>
            </div>

            <div>
              <h1 className="text-3xl font-semibold leading-tight tracking-tight text-balance xl:text-4xl">
                Set up your team&apos;s workspace in under a minute.
              </h1>
              <p className="mt-3 text-sm text-background/70">
                Save your office address, get a shareable code, and start comparing venues.
              </p>
            </div>

            <ul className="flex flex-col gap-5">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-background/10">
                    <f.icon className="size-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{f.title}</div>
                    <div className="text-sm text-background/60">{f.description}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-card p-8 sm:p-10 xl:p-12">
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
                <UtensilsCrossed className="size-4" />
              </span>
              <span className="font-semibold tracking-tight">Private Dining Finder</span>
            </div>

            <h2 className="text-xl font-semibold tracking-tight">Get started</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set up your company&apos;s workspace, or join one that already exists.
            </p>

            <Tabs defaultValue="create" className="mt-6">
              <TabsList className="w-full">
                <TabsTrigger value="create" className="flex-1">
                  Create workspace
                </TabsTrigger>
                <TabsTrigger value="join" className="flex-1">
                  Join workspace
                </TabsTrigger>
              </TabsList>

              <TabsContent value="create">
                <CreateWorkspaceWizard />
              </TabsContent>

              <TabsContent value="join">
                <form action={joinOrCreateWorkspaceAction} className="flex flex-col gap-4 pt-4">
                  <input type="hidden" name="mode" value="join" />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="code">Company code</Label>
                    <Input id="code" name="code" placeholder="e.g. NOWADAYS-4F2A" required autoFocus />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="displayName-join">Your name</Label>
                    <Input id="displayName-join" name="displayName" placeholder="So teammates know who searched" required />
                  </div>
                  <Button type="submit" className="mt-1 w-full">
                    Join workspace
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Ask a teammate for the code — they&apos;ll find it at the top of the app once inside.
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
