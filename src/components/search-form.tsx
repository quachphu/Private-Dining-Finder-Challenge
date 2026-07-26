import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export type SearchFormValues = {
  headcount: string;
  maxCommuteMinutes: string;
  commuteMode: string;
  style: string;
};

const selectClassName =
  "border-input flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function SearchForm({
  formId,
  defaultValues,
  persona,
}: {
  formId: string;
  defaultValues: SearchFormValues;
  persona?: string | null;
}) {
  // Keying the form on its own default values forces a full remount instead
  // of a prop update whenever the URL's search params change (e.g. clicking
  // a nav link back to a differently-parameterized /search). Without this,
  // React reconciles into the same uncontrolled inputs/selects, which keep
  // whatever value they already had — the fields would silently go stale
  // instead of reflecting the new URL (and Base UI's Input warns about
  // exactly this: a defaultValue prop changing after the field already
  // initialized as uncontrolled).
  const formKey = [defaultValues.headcount, defaultValues.maxCommuteMinutes, defaultValues.commuteMode, defaultValues.style].join("|");

  return (
    <form key={formKey} id={formId} action="/search" method="GET" className="grid gap-4 sm:grid-cols-3">
      {/* Carried through the GET submission so the chosen persona survives a
          search instead of resetting the pills on every result page. */}
      {persona && <input type="hidden" name="persona" value={persona} />}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="headcount">Headcount</Label>
        <Input id="headcount" name="headcount" type="number" min={1} required defaultValue={defaultValues.headcount} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="maxCommuteMinutes">Max commute (min)</Label>
        <Input
          id="maxCommuteMinutes"
          name="maxCommuteMinutes"
          type="number"
          min={1}
          required
          defaultValue={defaultValues.maxCommuteMinutes}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="commuteMode">Commute mode</Label>
        <select id="commuteMode" name="commuteMode" defaultValue={defaultValues.commuteMode} className={selectClassName}>
          <option value="walk">Walking</option>
          <option value="drive">Driving</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="style">Venue style</Label>
        <select id="style" name="style" defaultValue={defaultValues.style} className={selectClassName}>
          <option value="either">Any</option>
          <option value="seated">Seated dinner</option>
          <option value="reception">Reception / happy hour</option>
        </select>
      </div>

      <div className="flex items-end">
        <Button type="submit" className="w-full gap-1.5">
          <Search className="size-4" />
          Search venues
        </Button>
      </div>
    </form>
  );
}
