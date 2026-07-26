/**
 * Hand-researched fallback venues for the 3 required demo scenarios.
 * These guarantee the app has real results even before the live discovery
 * pipeline (src/lib/discovery) has crawled an area, and they stay in the
 * database permanently as `source: 'curated_seed'` alongside anything the
 * pipeline discovers later. Every trust label below reflects what was
 * actually confirmable from the venue's own site at research time — not a
 * default optimistic guess.
 */

export type SeedRoom = {
  roomName: string;
  minCapacity?: number;
  maxCapacity: number;
  style: "seated" | "reception" | "either";
  capacityTrust: "verified" | "likely" | "unverified";
  notes?: string;
};

export type SeedPhoto = {
  url: string;
  alt: string;
  isPrimary?: boolean;
};

export type SeedVenue = {
  name: string;
  formattedAddress: string;
  citySlug: "nyc-times-square" | "sf-financial-district" | "waikiki";
  category: string;
  neighborhood?: string;
  priceTier?: "$" | "$$" | "$$$" | "$$$$";
  priceTierTrust: "verified" | "likely" | "unverified";
  minSpendUsd?: number;
  minSpendTrust: "verified" | "likely" | "unverified";
  phone?: string;
  email?: string;
  website?: string;
  description: string;
  dietaryNotes?: string;
  menuUrl?: string;
  sourceNote: string;
  rooms: SeedRoom[];
  photos: SeedPhoto[];
};

// Deterministic placeholder photography (picsum.photos, seeded by slug) —
// stands in for real venue photography, which in production would come
// from the Google Places Photos API or licensed venue-supplied images.
//
// These are detected at render time by src/lib/photos.ts and visibly labeled
// "Placeholder image" in the UI. A stock photo captioned as a specific venue's
// private room is a factual claim about the room a planner is evaluating, so it
// gets called out rather than passed off as the real thing.
const photo = (seed: string, alt: string, isPrimary = false): SeedPhoto => ({
  url: `https://picsum.photos/seed/${seed}/1200/800`,
  alt,
  isPrimary,
});

// Genuine photographs of the venue itself, collected during the manual research
// pass and committed to /public. Where one of these exists it is the venue's
// *only* photo: padding it out with picsum filler would mean a "photo tour"
// that silently mixes one real room with two stock images, which is worse than
// showing a single accurate one.
const realPhoto = (file: string, alt: string): SeedPhoto => ({ url: `/${file}`, alt, isPrimary: true });

export const seedVenues: SeedVenue[] = [
  // ---------------------------------------------------------------- NYC
  {
    name: "Carmine's Italian Restaurant — Times Square",
    formattedAddress: "200 W 44th St, New York, NY 10036",
    citySlug: "nyc-times-square",
    category: "Italian, family-style",
    neighborhood: "Times Square",
    priceTier: "$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-917-512-7128",
    website: "https://carminesnyc.com/parties/times-square",
    description:
      "Family-style Italian institution with a dedicated second-floor party room featuring its own private entrance, bar, restrooms, and coat check.",
    sourceNote:
      "Room name and capacity confirmed directly from venue's own private-events page (carminesnyc.com/parties/times-square), July 2026.",
    rooms: [
      {
        roomName: "Jimmy Durante Room",
        maxCapacity: 200,
        minCapacity: 30,
        style: "either",
        capacityTrust: "verified",
        notes: "Seats up to 200; cocktail receptions up to 175. Private entrance, bar, and coat check.",
      },
    ],
    photos: [realPhoto("CarminesItalian.png", "Carmine's Italian Restaurant, Times Square")],
  },
  {
    name: "Dos Caminos — Times Square",
    formattedAddress: "1567 Broadway, New York, NY 10036",
    citySlug: "nyc-times-square",
    category: "Mexican",
    neighborhood: "Times Square",
    priceTier: "$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-212-918-1330",
    website: "https://www.doscaminos.com/private-events-venue/times-square/",
    description:
      "Vibrant Mexican restaurant at Broadway & 47th with a dedicated private room plus flexible cellar and bar buyout options.",
    sourceNote:
      "Room-by-room capacity breakdown taken directly from venue's private-events page, July 2026.",
    rooms: [
      { roomName: "Private Room", maxCapacity: 50, style: "seated", capacityTrust: "verified" },
      { roomName: "Main Cellar Dining", minCapacity: 15, maxCapacity: 190, style: "seated", capacityTrust: "verified" },
      { roomName: "Cellar Bar", maxCapacity: 40, style: "reception", capacityTrust: "verified" },
      { roomName: "Main Bar Buyout", maxCapacity: 50, style: "reception", capacityTrust: "verified" },
    ],
    photos: [realPhoto("DosCaminos.jpg", "Dos Caminos, Times Square")],
  },
  {
    name: "AperiBar (LUMA Hotel Times Square)",
    formattedAddress: "120 W 41st St, New York, NY 10036",
    citySlug: "nyc-times-square",
    category: "Italian, cocktail bar",
    neighborhood: "Times Square",
    priceTier: "$$$",
    priceTierTrust: "unverified",
    minSpendTrust: "unverified",
    phone: "+1-212-730-8900",
    website: "https://www.aperibar.com/private-events/",
    description:
      "Italian small-plates and cocktail bar inside the LUMA Hotel with private and semi-private event space, well suited to reception-style gatherings.",
    sourceNote:
      "Venue's private-events page states an aggregate 'up to 75 guests' for private/semi-private space but does not break this into named rooms — treated as likely, not verified.",
    rooms: [
      {
        roomName: "Private & Semi-Private Event Space",
        maxCapacity: 75,
        style: "reception",
        capacityTrust: "likely",
        notes: "Aggregate figure from venue site; not broken out by named room.",
      },
    ],
    photos: [realPhoto("AperiBar.jpg", "AperiBar at LUMA Hotel Times Square")],
  },
  {
    name: "Renaissance New York Times Square Hotel — Vivid",
    formattedAddress: "2 Times Square, New York, NY 10036",
    citySlug: "nyc-times-square",
    category: "Hotel event space",
    neighborhood: "Times Square",
    priceTier: "$$$$",
    priceTierTrust: "unverified",
    minSpendTrust: "unverified",
    website: "https://www.marriott.com/en-us/hotels/nycrt-renaissance-new-york-times-square-hotel/events/",
    description:
      "Hotel event floor overlooking Times Square; 'Vivid' is a dedicated 1,104 sq ft private room used for receptions and dinners.",
    sourceNote:
      "Capacity figure (120) is published on the hotel's Cvent/Marriott events listing but no per-catering minimum spend is published anywhere — call catering to confirm pricing and exact room configuration for a 50-person seated dinner.",
    rooms: [
      {
        roomName: "Vivid",
        maxCapacity: 120,
        style: "reception",
        capacityTrust: "likely",
        notes: "1,104 sq ft; figure from third-party events listing rather than venue's own page.",
      },
    ],
    photos: [realPhoto("RenaissanceNYTS.jpg", "Renaissance New York Times Square Hotel")],
  },

  // ----------------------------------------------------------------- SF
  {
    name: "Perbacco",
    formattedAddress: "230 California St, San Francisco, CA 94111",
    citySlug: "sf-financial-district",
    category: "Italian",
    neighborhood: "Financial District",
    priceTier: "$$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-415-955-0647",
    website: "https://www.perbaccosf.com/private-dining/",
    description:
      "Piedmontese Italian restaurant two blocks from Salesforce Tower with three distinct private rooms sized for everything from an 8-person chef's table to a 70-person reception.",
    sourceNote:
      "Full room-by-room capacity list (seated vs. standing) published on venue's own private-dining pages, July 2026.",
    rooms: [
      { roomName: "Chef's Table", maxCapacity: 8, style: "seated", capacityTrust: "verified" },
      { roomName: "Barolo Room", maxCapacity: 25, minCapacity: 10, style: "either", capacityTrust: "verified", notes: "18 seated / 25 standing." },
      { roomName: "Barbaresco Room", maxCapacity: 70, minCapacity: 20, style: "either", capacityTrust: "verified", notes: "40 seated / 70 standing." },
    ],
    photos: [
      photo("perbacco-1", "Perbacco Barbaresco private dining room", true),
      photo("perbacco-2", "Perbacco Italian plates"),
      photo("perbacco-3", "Perbacco dining room interior"),
    ],
  },
  {
    name: "MKT Restaurant & Bar — Four Seasons San Francisco",
    formattedAddress: "757 Market St, San Francisco, CA 94103",
    citySlug: "sf-financial-district",
    category: "Modern American, hotel restaurant",
    neighborhood: "Financial District",
    priceTier: "$$$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-415-633-3000",
    website: "https://www.fourseasons.com/sanfrancisco/dining/private_dining/",
    description:
      "Four Seasons hotel restaurant with modular private dining rooms that combine for larger groups.",
    sourceNote:
      "Capacity for 'Windows' room and combined-room total sourced from Four Seasons' own private-dining page.",
    rooms: [
      { roomName: "Windows", maxCapacity: 20, style: "seated", capacityTrust: "verified" },
      { roomName: "Windows + adjoining space (combined)", maxCapacity: 40, style: "either", capacityTrust: "likely" },
    ],
    photos: [photo("mkt-1", "Four Seasons MKT private dining room", true), photo("mkt-2", "MKT restaurant interior")],
  },
  {
    name: "Wayfare Tavern",
    formattedAddress: "201 Pine St, San Francisco, CA 94104",
    citySlug: "sf-financial-district",
    category: "American tavern",
    neighborhood: "Financial District",
    priceTier: "$$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-415-772-9060",
    website: "https://www.wayfaretavern.com/private-events",
    description:
      "Tyler Florence's American tavern with a second floor of four distinct private dining rooms plus a Chef's Alcove and Cellar Dining Room.",
    sourceNote:
      "Venue site advertises 'four distinct private dining rooms' without publishing a per-room number; a secondary source cites 58 as a combined figure. Numbers disagree across sources, so this is marked likely rather than verified — call to confirm which room fits a 30-person group.",
    rooms: [
      {
        roomName: "Second-floor private rooms (unspecified breakdown)",
        maxCapacity: 58,
        style: "either",
        capacityTrust: "likely",
        notes: "Aggregate figure; venue has 4 named rooms but per-room capacities aren't published.",
      },
    ],
    photos: [photo("wayfare-1", "Wayfare Tavern private dining room", true)],
  },
  {
    name: "Kokkari Estiatorio",
    formattedAddress: "200 Jackson St, San Francisco, CA 94111",
    citySlug: "sf-financial-district",
    category: "Greek",
    neighborhood: "Financial District / Jackson Square",
    priceTier: "$$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-415-981-0983",
    email: "events@kokkari.com",
    website: "https://kokkari.com/private-dining/",
    description:
      "Michelin-recognized Greek restaurant with a hand-carved chef's table plus two named private rooms.",
    sourceNote:
      "Room names and capacities published on venue's private-dining PDF/page, including a 30-person Oenos Room — a strong fit for the 30-person scenario.",
    rooms: [
      { roomName: "Hania Room", maxCapacity: 10, style: "seated", capacityTrust: "verified" },
      { roomName: "Oenos Room", maxCapacity: 30, style: "either", capacityTrust: "verified" },
      { roomName: "Chef's Table", maxCapacity: 20, style: "seated", capacityTrust: "verified" },
    ],
    photos: [photo("kokkari-1", "Kokkari Oenos private dining room", true), photo("kokkari-2", "Kokkari Greek cuisine")],
  },
  {
    name: "The Vault Steakhouse & Garden",
    formattedAddress: "555 California St, San Francisco, CA 94104",
    citySlug: "sf-financial-district",
    category: "Steakhouse",
    neighborhood: "Financial District",
    priceTier: "$$$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-415-508-4675",
    email: "tricci@hineighborsf.com",
    website: "https://www.thevault555.com/",
    description:
      "Upscale steakhouse at the base of the Bank of America Center with a private room and adjoining garden.",
    sourceNote:
      "Capacity (up to 20 guests) confirmed via venue's event contact — deliberately included even though it's below the 30-person scenario headcount, to demonstrate the ranking algorithm correctly filtering out venues that can't fit the group.",
    rooms: [
      { roomName: "Private Dining Room", maxCapacity: 20, style: "seated", capacityTrust: "verified", notes: "Up to 20 at four tables, or 14 at one table." },
    ],
    photos: [photo("vault-1", "The Vault private dining room", true)],
  },

  // ------------------------------------------------------------- Waikiki
  {
    name: "Hilton Hawaiian Village — South Pacific & Tapa Ballrooms",
    formattedAddress: "2005 Kalia Rd, Honolulu, HI 96815",
    citySlug: "waikiki",
    category: "Hotel ballroom / event space",
    neighborhood: "Waikiki",
    priceTier: "$$$$",
    priceTierTrust: "unverified",
    minSpendTrust: "unverified",
    website: "https://hiltonhawaiianvillage.com/gather/venues/",
    description:
      "The resort's own event venues — multiple ballrooms and an outdoor Village Green, all on-property (0 min walk from the resort itself).",
    sourceNote:
      "Room names and capacities published directly on hiltonhawaiianvillage.com/gather/venues — verified. Catering minimum spend is quote-based and not published, so price signal stays unverified.",
    rooms: [
      { roomName: "South Pacific Ballroom", maxCapacity: 200, style: "seated", capacityTrust: "verified" },
      { roomName: "Tapa Ballroom", minCapacity: 150, maxCapacity: 1500, style: "either", capacityTrust: "verified", notes: "150–1,000 seated / 249–1,500 standing." },
      { roomName: "Village Green (outdoor)", minCapacity: 100, maxCapacity: 300, style: "reception", capacityTrust: "verified", notes: "200 banquet-style / 300 reception, tropical gardens setting." },
    ],
    photos: [
      photo("hilton-hv-1", "Hilton Hawaiian Village outdoor Village Green event setup", true),
      photo("hilton-hv-2", "Hilton Hawaiian Village ballroom"),
      photo("hilton-hv-3", "Hilton Hawaiian Village grounds"),
    ],
  },
  {
    name: "Sheraton Waikiki — Hawaii Ballroom & Lanai Room",
    formattedAddress: "2255 Kalakaua Ave, Honolulu, HI 96815",
    citySlug: "waikiki",
    category: "Hotel ballroom / event space",
    neighborhood: "Waikiki",
    priceTier: "$$$$",
    priceTierTrust: "unverified",
    minSpendTrust: "unverified",
    website: "https://www.marriott.com/en-us/hotels/hnlws-sheraton-waikiki-beach-resort/events/",
    description:
      "One of Oahu's largest hotel event floors — the Hawaii Ballroom can run as one 3,700-guest room or split into four sections for smaller receptions, about a 12-15 minute walk down Kalakaua Ave from Hilton Hawaiian Village.",
    sourceNote:
      "Room names and capacities sourced from a third-party venue marketplace (Vendry) referencing the hotel's own event space, not Marriott's private-dining page directly — treated as likely rather than verified. Confirm exact sectioned capacity with the hotel's events team.",
    rooms: [
      { roomName: "Hawaii Ballroom (divided section)", maxCapacity: 500, style: "either", capacityTrust: "likely", notes: "Full ballroom divides into 4 sections, each up to ~500 guests." },
      { roomName: "Lanai Room", maxCapacity: 480, style: "either", capacityTrust: "likely" },
    ],
    photos: [photo("sheraton-waikiki-1", "Sheraton Waikiki Hawaii Ballroom event setup", true)],
  },
  {
    name: "Tropics Bar & Grill (Hilton Hawaiian Village)",
    formattedAddress: "2005 Kalia Rd, Honolulu, HI 96815",
    citySlug: "waikiki",
    category: "Beachfront bar & grill, happy hour",
    neighborhood: "Waikiki",
    priceTier: "$$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-808-949-4321",
    website: "https://hiltonhawaiianvillage.com/dine/tropics-bar-and-grill/",
    description:
      "Beachfront happy-hour bar and grill inside the resort's Ali'i tower — daily happy hour, live music, and a large outdoor footprint well suited to a reception-style event.",
    sourceNote:
      "Venue confirms daily happy hour and beachfront layout, but no published full-buyout capacity for private events — estimate below is inferred from the venue's beachfront restaurant footprint, not a quoted figure. Call events team to confirm.",
    rooms: [
      { roomName: "Full restaurant buyout (estimated)", maxCapacity: 180, style: "reception", capacityTrust: "unverified" },
    ],
    photos: [photo("tropics-1", "Tropics Bar & Grill beachfront happy hour", true), photo("tropics-2", "Tropics Bar & Grill outdoor seating")],
  },
  {
    name: "Chart House Waikiki",
    formattedAddress: "1765 Ala Moana Blvd, Honolulu, HI 96815",
    citySlug: "waikiki",
    category: "Steakhouse & seafood, happy hour",
    neighborhood: "Waikiki / Ala Moana",
    priceTier: "$$$",
    priceTierTrust: "likely",
    minSpendTrust: "unverified",
    phone: "+1-808-941-6669",
    website: "https://charthousewaikiki.com/",
    description:
      "Oceanfront steakhouse and seafood restaurant with two daily happy hours, roughly a 5–10 minute walk from Hilton Hawaiian Village.",
    sourceNote:
      "No private-dining page or published capacity found on the venue's own site — flagged unverified/needs a call. Estimated capacity is a rough category-based guess, not a quoted number.",
    rooms: [
      { roomName: "Group buyout (estimated, unconfirmed)", maxCapacity: 100, style: "reception", capacityTrust: "unverified" },
    ],
    photos: [photo("charthouse-1", "Chart House Waikiki oceanfront dining", true)],
  },
  {
    name: "The Laylow, Autograph Collection",
    formattedAddress: "2299 Kuhio Ave, Honolulu, HI 96815",
    citySlug: "waikiki",
    category: "Boutique hotel lounge / event space",
    neighborhood: "Waikiki",
    priceTier: "$$$",
    priceTierTrust: "unverified",
    minSpendTrust: "unverified",
    website: "https://www.laylowwaikiki.com/events-hosting/",
    description:
      "Retro-tropical boutique hotel with a dedicated 1,500+ sq ft event space, well suited to a reception/happy-hour-style booking.",
    sourceNote:
      "Guest count (200) and square footage published on venue's own events page — treated as likely rather than verified since the room isn't individually named. On Kuhio Ave, roughly 15–20 min walk from Hilton Hawaiian Village — useful edge case for the 15-minute walking cutoff.",
    rooms: [
      { roomName: "Event Space", maxCapacity: 200, style: "reception", capacityTrust: "likely", notes: "1,500+ sq ft, unnamed single room." },
    ],
    photos: [photo("laylow-1", "The Laylow Waikiki event space", true)],
  },
];
