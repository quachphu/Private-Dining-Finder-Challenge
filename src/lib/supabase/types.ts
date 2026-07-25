// Hand-written types mirroring supabase/migrations/0001_init.sql.
// If you prefer generated types, run:
//   npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts

export type TrustLevel = "verified" | "likely" | "unverified";
export type CommuteMode = "walk" | "drive";
export type RoomStyle = "seated" | "reception" | "either";
export type VenueSource = "curated_seed" | "auto_discovered";

export type CompanyRow = {
  id: string;
  name: string;
  code: string;
  created_by: string | null;
  created_at: string;
}

export type SavedAddressRow = {
  id: string;
  company_id: string;
  label: string;
  formatted_address: string;
  lat: number;
  lng: number;
  created_by: string | null;
  created_at: string;
}

export type SearchRow = {
  id: string;
  company_id: string;
  saved_address_id: string | null;
  origin_label: string;
  origin_lat: number;
  origin_lng: number;
  headcount: number;
  max_commute_minutes: number;
  commute_mode: CommuteMode;
  style: RoomStyle | null;
  created_by: string | null;
  created_at: string;
}

export type VenueRow = {
  id: string;
  source: VenueSource;
  place_source_id: string | null;
  name: string;
  formatted_address: string;
  lat: number;
  lng: number;
  city_slug: string;
  category: string;
  neighborhood: string | null;
  price_tier: string | null;
  price_tier_trust: TrustLevel;
  min_spend_usd: number | null;
  min_spend_trust: TrustLevel;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  dietary_notes: string | null;
  menu_url: string | null;
  source_note: string | null;
  last_checked_at: string;
  created_at: string;
}

export type VenueRoomRow = {
  id: string;
  venue_id: string;
  room_name: string;
  min_capacity: number | null;
  max_capacity: number;
  style: RoomStyle;
  capacity_trust: TrustLevel;
  notes: string | null;
}

export type VenuePhotoRow = {
  id: string;
  venue_id: string;
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
}

export type ShortlistItemRow = {
  id: string;
  company_id: string;
  venue_id: string;
  search_id: string | null;
  added_by: string | null;
  note: string | null;
  created_at: string;
}

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

// Mirrors how `supabase gen types` marks nullable columns optional on Insert.
type OptionalNullable<T> = { [K in keyof T as null extends T[K] ? K : never]?: T[K] } & {
  [K in keyof T as null extends T[K] ? never : K]: T[K];
};

type TableDef<Row, Insert, Relationships extends Relationship[] = []> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Insert>;
  Relationships: Relationships;
};

export type Database = {
  public: {
    Tables: {
      companies: TableDef<CompanyRow, OptionalNullable<Omit<CompanyRow, "id" | "created_at">> & { id?: string }>;
      saved_addresses: TableDef<
        SavedAddressRow,
        OptionalNullable<Omit<SavedAddressRow, "id" | "created_at">> & { id?: string },
        [
          {
            foreignKeyName: "saved_addresses_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ]
      >;
      searches: TableDef<
        SearchRow,
        OptionalNullable<Omit<SearchRow, "id" | "created_at">> & { id?: string },
        [
          {
            foreignKeyName: "searches_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "searches_saved_address_id_fkey";
            columns: ["saved_address_id"];
            isOneToOne: false;
            referencedRelation: "saved_addresses";
            referencedColumns: ["id"];
          },
        ]
      >;
      venues: TableDef<VenueRow, OptionalNullable<Omit<VenueRow, "id" | "created_at">> & { id?: string }>;
      venue_rooms: TableDef<
        VenueRoomRow,
        OptionalNullable<Omit<VenueRoomRow, "id">> & { id?: string },
        [
          {
            foreignKeyName: "venue_rooms_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venues";
            referencedColumns: ["id"];
          },
        ]
      >;
      venue_photos: TableDef<
        VenuePhotoRow,
        OptionalNullable<Omit<VenuePhotoRow, "id">> & { id?: string },
        [
          {
            foreignKeyName: "venue_photos_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venues";
            referencedColumns: ["id"];
          },
        ]
      >;
      shortlist_items: TableDef<
        ShortlistItemRow,
        OptionalNullable<Omit<ShortlistItemRow, "id" | "created_at">> & { id?: string },
        [
          {
            foreignKeyName: "shortlist_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shortlist_items_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venues";
            referencedColumns: ["id"];
          },
        ]
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
