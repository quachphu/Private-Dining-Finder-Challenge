import "server-only";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/supabase/types";

const COMPANY_ID_COOKIE = "pdf_company_id";
const DISPLAY_NAME_COOKIE = "pdf_display_name";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function slugify(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export async function getCurrentCompany(): Promise<CompanyRow | null> {
  const store = await cookies();
  const companyId = store.get(COMPANY_ID_COOKIE)?.value;
  if (!companyId) return null;

  const supabase = createServiceClient();
  const { data } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
  return data ?? null;
}

export async function getDisplayName(): Promise<string | null> {
  const store = await cookies();
  return store.get(DISPLAY_NAME_COOKIE)?.value ?? null;
}

export async function setDisplayName(name: string): Promise<void> {
  const store = await cookies();
  store.set(DISPLAY_NAME_COOKIE, name, { maxAge: COOKIE_MAX_AGE, sameSite: "lax" });
}

export async function createCompanyWorkspace(name: string, createdBy: string): Promise<{ company: CompanyRow; code: string }> {
  const supabase = createServiceClient();

  // Retry on the rare code collision (unique constraint on companies.code).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${slugify(name) || "COMPANY"}-${randomSuffix()}`;
    const { data, error } = await supabase.from("companies").insert({ name, code, created_by: createdBy }).select("*").single();
    if (!error && data) {
      const store = await cookies();
      store.set(COMPANY_ID_COOKIE, data.id, { maxAge: COOKIE_MAX_AGE, sameSite: "lax" });
      return { company: data, code };
    }
  }
  throw new Error("Could not create a company workspace — please try again.");
}

export async function joinCompanyWorkspace(code: string): Promise<CompanyRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("companies").select("*").eq("code", code.trim().toUpperCase()).maybeSingle();
  if (!data) return null;

  const store = await cookies();
  store.set(COMPANY_ID_COOKIE, data.id, { maxAge: COOKIE_MAX_AGE, sameSite: "lax" });
  return data;
}

export async function leaveCompanyWorkspace(): Promise<void> {
  const store = await cookies();
  store.delete(COMPANY_ID_COOKIE);
}
