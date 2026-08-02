// Hand-written types mirroring supabase/migrations/0001_init.sql.
// If you prefer generated types, run:
//   npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts

export type TrustLevel = "confirmed_by_planner" | "verified" | "likely" | "ai_extracted" | "unverified";

export type VenueConfirmationRow = {
  id: string;
  venue_id: string;
  room_id: string | null;
  company_id: string;
  confirmed_by: string;
  confirmed_max_capacity: number | null;
  confirmed_min_spend_usd: number | null;
  note: string | null;
  created_at: string;
};
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
  dietary_trust: TrustLevel;
  menu_url: string | null;
  menu_trust: TrustLevel;
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
  is_selected: boolean;
  created_at: string;
}

export type ShortlistAttachmentType = "image" | "video";

/**
 * 'planning' is the colleagues choosing a venue; 'event' is everyone actually
 * attending, answering the host's dietary question. Same table, different
 * audience — see supabase/migrations/0010_event_dietary_flow.sql.
 */
export type ShortlistMessageChannel = "planning" | "event";

export type ShortlistMessageRow = {
  id: string;
  shortlist_item_id: string;
  company_id: string;
  author: string;
  message: string;
  attachment_url: string | null;
  attachment_type: ShortlistAttachmentType | null;
  is_highlight_reel: boolean;
  channel: ShortlistMessageChannel;
  created_at: string;
}

/** How firm a stated dietary need is, which changes how a kitchen must treat it. */
export type DietaryNeedKind = "allergy" | "intolerance" | "preference" | "unclear";

/**
 * Severity is per item rather than per person on purpose: "no pork for me, and
 * I got allergy with peanut" is one message stating two different things, and
 * flattening it to a single severity either invents an allergy or hides one.
 */
export type DietaryNeed = {
  item: string;
  kind: DietaryNeedKind;
};

export type DietaryPerson = {
  name: string;
  needs: DietaryNeed[];
  /** The attendee's own words, so the host can always check the extraction. */
  quote: string;
};

/**
 * Structured dietary roster extracted from an event thread. Stored as jsonb on
 * dietary_summaries.summary.
 */
export type DietarySummary = {
  people: DietaryPerson[];
  /** Requirement → how many attendees stated it, for ordering in bulk. */
  aggregate: { requirement: string; count: number }[];
  /** Messages the model could not confidently read, quoted verbatim. */
  unclear: string[];
  /** A short paragraph the host can send to the venue as-is. */
  orderNote: string;
};

export type DietarySummaryRow = {
  id: string;
  shortlist_item_id: string;
  company_id: string;
  summary: DietarySummary;
  message_count: number;
  generated_by: string | null;
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
      shortlist_messages: TableDef<
        ShortlistMessageRow,
        OptionalNullable<Omit<ShortlistMessageRow, "id" | "created_at">> & { id?: string },
        [
          {
            foreignKeyName: "shortlist_messages_shortlist_item_id_fkey";
            columns: ["shortlist_item_id"];
            isOneToOne: false;
            referencedRelation: "shortlist_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shortlist_messages_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ]
      >;
      venue_confirmations: TableDef<
        VenueConfirmationRow,
        OptionalNullable<Omit<VenueConfirmationRow, "id" | "created_at">> & { id?: string },
        [
          {
            foreignKeyName: "venue_confirmations_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venue_confirmations_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "venue_rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venue_confirmations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ]
      >;
      dietary_summaries: TableDef<
        DietarySummaryRow,
        OptionalNullable<Omit<DietarySummaryRow, "id" | "created_at">> & { id?: string },
        [
          {
            foreignKeyName: "dietary_summaries_shortlist_item_id_fkey";
            columns: ["shortlist_item_id"];
            isOneToOne: false;
            referencedRelation: "shortlist_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dietary_summaries_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
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
