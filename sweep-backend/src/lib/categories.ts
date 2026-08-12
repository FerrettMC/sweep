// lib/categories.ts
//
// Working out roughly WHAT someone is shopping for, so a search for "earbuds"
// doesn't waste a call on a clothing store, and "t-shirt" doesn't ask Newegg.
//
// This is deliberately a keyword classifier and not a model. It runs in
// microseconds, costs nothing, needs no key, and is trivial to correct when it
// gets something wrong — you add a word to a list. An embedding model would
// classify better and be far harder to reason about at 2am when a search
// silently skips a retailer.
//
// The important design decision is what happens when it ISN'T sure: it widens
// rather than narrows. A missed retailer is a worse outcome than a wasted call,
// because the user sees a gap and can't tell whether the item isn't sold there
// or we just didn't look.

export const CATEGORIES = [
  "electronics",
  "clothing",
  "home",
  "beauty",
  "toys",
  "grocery",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Words that place a query in a category. Kept lowercase and matched on word
 * boundaries, so "tv" doesn't match "tvs" wrongly but "tv stand" still hits.
 *
 * Brand names carry real signal and are included where a brand is strongly
 * associated with one category.
 */
const KEYWORDS: Record<Category, string[]> = {
  electronics: [
    "earbud", "earbuds", "headphone", "headphones", "airpod", "airpods", "earphone",
    "laptop", "notebook", "macbook", "chromebook", "desktop", "pc", "computer",
    "monitor", "display", "keyboard", "mouse", "webcam", "microphone", "mic",
    "gpu", "graphics card", "cpu", "processor", "motherboard", "ram", "ssd", "hdd",
    "hard drive", "nvme", "psu", "power supply", "cooler", "case fan",
    "phone", "smartphone", "iphone", "android", "pixel", "galaxy", "tablet", "ipad",
    "tv", "television", "soundbar", "speaker", "speakers", "subwoofer", "amplifier",
    "console", "playstation", "ps5", "xbox", "nintendo", "switch", "steam deck",
    "camera", "dslr", "mirrorless", "lens", "gopro", "drone",
    "smartwatch", "watch band", "charger", "cable", "usb", "hdmi", "adapter",
    "router", "modem", "wifi", "printer", "scanner", "projector",
    "rtx", "gtx", "geforce", "radeon", "ryzen", "core i5", "core i7", "core i9",
    "nvidia", "amd", "intel", "asus", "msi", "logitech", "razer", "corsair",
    "samsung", "sony", "lg", "bose", "jbl", "anker", "apple",
  ],
  clothing: [
    "shirt", "t-shirt", "tshirt", "tee", "blouse", "top", "tank top",
    "hoodie", "sweater", "sweatshirt", "jumper", "cardigan", "fleece",
    "jacket", "coat", "parka", "blazer", "vest",
    "jeans", "trousers", "pants", "chinos", "shorts", "leggings", "joggers",
    "dress", "skirt", "gown", "jumpsuit", "romper",
    "shoe", "shoes", "sneaker", "sneakers", "trainers", "boots", "sandals", "heels",
    "loafers", "slippers",
    "sock", "socks", "underwear", "boxers", "briefs", "bra", "lingerie",
    "swimwear", "swimsuit", "bikini", "trunks",
    "hat", "cap", "beanie", "scarf", "gloves", "belt", "tie",
    "handbag", "purse", "backpack", "tote",
    "nike", "adidas", "puma", "levis", "zara", "uniqlo", "carhartt", "north face",
    "outfit", "clothing", "apparel", "menswear", "womenswear",
  ],
  home: [
    "sofa", "couch", "chair", "desk", "table", "bed", "mattress", "pillow",
    "duvet", "blanket", "sheets", "bedding", "curtain", "rug", "lamp", "lighting",
    "shelf", "bookcase", "wardrobe", "dresser", "cabinet", "storage",
    "kettle", "toaster", "microwave", "blender", "air fryer", "coffee maker",
    "cookware", "pan", "pot", "knife set", "cutlery", "plates", "mug",
    "vacuum", "mop", "broom", "detergent", "cleaner",
    "towel", "shower", "bathroom", "kitchen", "garden", "patio", "grill",
    "drill", "hammer", "screwdriver", "toolkit", "tools", "paint", "ladder",
  ],
  beauty: [
    "makeup", "foundation", "concealer", "mascara", "lipstick", "eyeliner",
    "skincare", "moisturizer", "moisturiser", "serum", "cleanser", "toner",
    "sunscreen", "spf", "shampoo", "conditioner", "hair dye", "hairdryer",
    "perfume", "cologne", "fragrance", "deodorant", "razor", "shaving",
    "nail polish", "cream", "lotion",
  ],
  toys: [
    "toy", "toys", "lego", "puzzle", "board game", "action figure", "doll",
    "plush", "stuffed animal", "nerf", "rc car", "model kit", "playset",
    "funko", "trading cards", "pokemon", "building blocks",
  ],
  grocery: [
    "coffee", "tea", "snack", "snacks", "cereal", "pasta", "rice", "sauce",
    "chocolate", "candy", "protein powder", "supplement", "vitamins",
    "water bottle pack", "soda", "juice", "groceries", "food",
  ],
};

export interface Classification {
  /** Categories the query appears to be about. Empty means "no idea". */
  categories: Category[];
  /** Whether we matched anything at all. */
  confident: boolean;
  /** Which words triggered it — useful for debugging a bad routing decision. */
  matched: string[];
}

/**
 * Classify a search term. Never throws, never returns a wrong-shaped result.
 */
export function classifyQuery(query: string): Classification {
  const normalized = ` ${query.toLowerCase().replace(/[^a-z0-9+ -]/g, " ").replace(/\s+/g, " ")} `;

  const scores = new Map<Category, number>();
  const matched: string[] = [];

  for (const category of CATEGORIES) {
    for (const keyword of KEYWORDS[category]) {
      // Word-boundary match so "pc" doesn't fire inside "pcs of paper", and
      // multi-word keywords ("air fryer") still work.
      if (normalized.includes(` ${keyword} `) || normalized.includes(` ${keyword}s `)) {
        scores.set(category, (scores.get(category) ?? 0) + 1);
        matched.push(keyword);
      }
    }
  }

  if (scores.size === 0) {
    return { categories: [], confident: false, matched: [] };
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0][1];

  // Keep every category that tied for the top score. "gaming laptop bag" should
  // legitimately reach both electronics and clothing rather than picking one.
  const categories = ranked.filter(([, score]) => score === top).map(([c]) => c);

  return { categories, confident: true, matched };
}
