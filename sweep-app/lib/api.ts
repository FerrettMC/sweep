// lib/api.ts
//
// The only place the app talks to the backend. Every call carries the Supabase
// access token when signed in, and the anonymous device id otherwise, so the
// server can apply the right limits without the client asserting anything.

import Constants from "expo-constants";
import { getDeviceId } from "./deviceId";
import { supabase } from "./supabase";

/**
 * On a physical Android device, localhost is the phone, not your machine.
 * The android script in package.json runs `adb reverse tcp:3001 tcp:3001`,
 * which is what makes localhost work there. Set EXPO_PUBLIC_API_URL to point
 * somewhere else (a LAN IP, or the deployed backend).
 */
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  Constants.expoConfig?.extra?.apiUrl ??
  "http://localhost:3001";

/** Thrown for any non-2xx response, carrying the server's error contract. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: any,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = "GET", body } = options;

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = {};
  // Only declare a JSON body when there actually is one — Fastify rejects a
  // request that claims application/json and sends nothing.
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  // Guests are identified by device. Sent even when signed in so the server
  // could reconcile a guest's history on signup later.
  headers["x-device-id"] = await getDeviceId();

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      "Can't reach Sweep. Check your connection and that the backend is running.",
      0,
      "NETWORK_ERROR",
    );
  }

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error ?? `Request failed (${response.status})`,
      response.status,
      payload?.code,
      payload,
    );
  }

  return payload as T;
}

// ---- types shared with the server ------------------------------------------

export interface Product {
  id: string;
  retailer: string;
  retailerId: string;
  url: string;
  title: string;
  imageUrl: string | null;
  price: number | null;
  listPrice: number | null;
  currency: string;
  availability: string | null;
  rating: number | null;
  ratingCount: number | null;
  lastCheckedAt: string | null;
  lastStatus: string | null;
}

/** A search result hasn't been saved yet, so it has no Product id. */
export interface SearchProduct {
  retailer: string;
  retailerId: string;
  title: string;
  price: number | null;
  listPrice: number | null;
  currency: string;
  imageUrl: string | null;
  url: string;
  availability: string | null;
  rating: number | null;
  ratingCount: number | null;
  /** eBay only — seller feedback %, since eBay publishes no product rating. */
  sellerRating: number | null;
  sellerRatingCount: number | null;
}

export interface TrackedProduct {
  id: string;
  addedAt: string;
  customThreshold: number | null;
  lastNotifiedAt?: string | null;
  /** Price when this user started watching, in cents. */
  priceAtTracking: number | null;
  product: Product;
}

export interface Quota {
  used: number;
  limit: number;
  remaining: number;
  bonus: number;
  canWatchAd: boolean;
  resetsAt: string;
}

export interface RetailerResult {
  retailer: string;
  label: string;
  status: "success" | "failed" | "blocked";
  message: string | null;
  products: SearchProduct[];
}

export interface Highlight {
  kind: "cheapest" | "best_rated" | "biggest_discount";
  label: string;
  reason: string;
  product: SearchProduct;
}

export interface SearchResponse {
  keyword: string;
  quota: Quota;
  /** The few results worth showing above the per-store columns. */
  highlights: Highlight[];
  /** What the server decided the query was about. */
  categories: string[];
  /** Stores deliberately not searched, because they don't sell this kind of thing. */
  skipped: { retailer: string; label: string }[];
  /**
   * Set when Amazon is still running. Bright Data's free tier can take up to
   * ~3 minutes, so Amazon is fetched out-of-band and polled separately rather
   * than holding up the four retailers that answer in seconds.
   */
  amazonJobId: string | null;
  results: RetailerResult[];
}

export interface AmazonJobResult {
  status: "pending" | "success" | "failed" | "blocked";
  retailer: string;
  label: string;
  products: SearchProduct[];
  message: string | null;
  elapsedMs: number;
}

export interface PricePoint {
  price: number;
  checkedAt: string;
}

export interface ProductDetail {
  product: Product;
  history: PricePoint[];
  stats: {
    low: number | null;
    high: number | null;
    average: number | null;
    percentBelowAverage: number | null;
  };
  tracking: { id: string; customThreshold: number | null } | null;
  historyWindow: { days: number | null; shown: number; total: number };
}

// ---- endpoints -------------------------------------------------------------

export function syncUser(email: string) {
  return request<{ user: unknown }>("/auth/sync-user", {
    method: "POST",
    body: { email },
  });
}

export function getQuota() {
  return request<{ quota: Quota; isGuest: boolean; tier: string }>("/search/quota");
}

export function search(keyword: string, retailers?: string[]) {
  const params = new URLSearchParams({ q: keyword });
  if (retailers?.length) params.set("retailers", retailers.join(","));
  return request<SearchResponse>(`/search?${params}`);
}

export function getAmazonSearchResult(jobId: string) {
  return request<AmazonJobResult>(`/search/amazon/${jobId}`);
}

export function claimRewardedSearch() {
  return request<{ quota: Quota }>("/search/rewarded", { method: "POST" });
}

export function getTrackedProducts() {
  return request<{
    tracked: TrackedProduct[];
    limits: { maxTrackedProducts: number; used: number };
    tier: string;
  }>("/products");
}

export interface TrackLimits {
  maxTrackedProducts: number;
  used: number;
  canTrack: boolean;
  checkTimesPerDay: number;
  fixedCheckTimes: boolean;
  checkIntervalMinutes: number;
}

export interface ProductPreview {
  product: Product;
  alreadyTracking: boolean;
  limits: TrackLimits;
  schedule: {
    checkHours: number[];
    timezone: string;
    nextCheckAt: string | null;
  };
  tier: string;
}

/** Scrape a pasted link and show what we found, without committing to track it. */
export function previewProduct(url: string) {
  return request<ProductPreview>("/products/preview", {
    method: "POST",
    body: { url },
  });
}

export function trackProduct(
  target: { url: string } | { retailer: string; retailerId: string },
  /** Only the timezone is sent now — check times aren't user-chosen. */
  options?: { timezone: string },
) {
  return request<{ tracked: TrackedProduct }>("/products/track", {
    method: "POST",
    body: { ...target, ...(options ?? {}) },
  });
}

export interface Schedule {
  checkHours: number[];
  /** Minute offset for interval tiers: "every 2 hours at :35". */
  checkMinute: number;
  timezone: string;
  maxCheckTimes: number;
  maxCheckMinute: number;
  fixedCheckTimes: boolean;
  canSetCheckMinute: boolean;
  checkIntervalMinutes: number;
  nextCheckAt: string | null;
  tier: string;
}

export function getSchedule() {
  return request<Schedule>("/me/schedule");
}

export function updateSchedule(
  timezone: string,
  options: { checkHours?: number[]; checkMinute?: number },
) {
  return request<{
    checkHours: number[];
    checkMinute: number;
    timezone: string;
    maxCheckTimes: number;
    maxCheckMinute: number;
    nextCheckAt: string | null;
  }>("/me/schedule", { method: "PUT", body: { timezone, ...options } });
}

export function untrackProduct(trackedId: string) {
  return request<{ ok: true }>(`/products/track/${trackedId}`, {
    method: "DELETE",
  });
}

export function getProductDetail(productId: string) {
  return request<ProductDetail>(`/products/${productId}`);
}

export interface ManualCheckState {
  used: number;
  /** Null when the tier has no daily cap (Pro/Ultimate). */
  limit: number | null;
  remaining: number | null;
  cooldownMinutes: number | null;
  availableAt: string | null;
  resetsAt: string;
}

export function refreshProduct(productId: string) {
  return request<{
    status: string;
    product: Product | null;
    manualChecks: ManualCheckState | null;
  }>(`/products/${productId}/refresh`, { method: "POST" });
}

export function getManualChecks() {
  return request<{ manualChecks: ManualCheckState }>("/products/manual-checks");
}

export function setCustomThreshold(trackedId: string, cents: number | null) {
  return request<{ ok: true; customThreshold: number | null }>(
    `/products/track/${trackedId}`,
    { method: "PATCH", body: { customThreshold: cents } },
  );
}

export function registerPushToken(token: string, platform: "ios" | "android") {
  return request<{ ok: true }>("/notifications/register", {
    method: "POST",
    body: { token, platform },
  });
}

export function unregisterPushToken(token: string) {
  return request<{ ok: true }>("/notifications/register", {
    method: "DELETE",
    body: { token },
  });
}

export function getNotificationStatus() {
  return request<{ registered: boolean; devices: number }>(
    "/notifications/status",
  );
}

// ---- lists ----

export interface ListItem {
  id: string;
  note: string | null;
  claimed: boolean;
  addedAt: string;
  product: {
    id: string;
    retailer: string;
    retailerId: string;
    title: string;
    imageUrl: string | null;
    url: string;
    price: number | null;
    listPrice: number | null;
  };
}

export interface GiftList {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  shareToken: string | null;
  createdAt: string;
  itemCount: number;
  totalValue: number;
  items: ListItem[];
}

export function getLists() {
  return request<{
    lists: GiftList[];
    limits: { maxLists: number; maxItemsPerList: number; used: number };
    tier: string;
  }>("/lists");
}

export function createList(name: string, description?: string) {
  return request<{ list: GiftList }>("/lists", {
    method: "POST",
    body: { name, description },
  });
}

export function renameList(id: string, name: string) {
  return request<{ ok: true }>(`/lists/${id}`, { method: "PATCH", body: { name } });
}

export function deleteList(id: string) {
  return request<{ ok: true }>(`/lists/${id}`, { method: "DELETE" });
}

export function addListItem(
  listId: string,
  target: { url: string } | { retailer: string; retailerId: string },
  note?: string,
) {
  return request<{ item: ListItem }>(`/lists/${listId}/items`, {
    method: "POST",
    body: { ...target, note },
  });
}

export function removeListItem(listId: string, itemId: string) {
  return request<{ ok: true }>(`/lists/${listId}/items/${itemId}`, {
    method: "DELETE",
  });
}

export function setListSharing(listId: string, enabled: boolean) {
  return request<{ isPublic: boolean; shareToken: string | null }>(
    `/lists/${listId}/share`,
    { method: "POST", body: { enabled } },
  );
}

// ---- plans ----

export interface PlanFeature {
  label: string;
  group: "tracking" | "search" | "budget" | "lists" | "extras";
  included: boolean;
}

export interface Plan {
  tier: string;
  name: string;
  tagline: string;
  pricing: {
    monthly: number | null;
    yearly: number | null;
    yearlySavingPercent: number | null;
    /** What the yearly price works out to per month. */
    yearlyPerMonth: number | null;
  };
  /** Short ribbon above the name, e.g. "MOST POPULAR". Null for Free. */
  badge: string | null;
  /** The handful of numbers that improve at this tier. `from` is null on Free. */
  upgrades: { label: string; from: string | null; to: string }[];
  /** Features that switch on at this tier and weren't available below it. */
  unlocks: string[];
  features: PlanFeature[];
  highlighted: boolean;
}

export function getPlans() {
  return request<{
    plans: Plan[];
    groupLabels: Record<string, string>;
    currentTier: string | null;
  }>("/plans");
}

// ---- deals feed ----

export interface Deal {
  id: string;
  percentBelowAverage: number;
  previousPrice: number;
  newPrice: number;
  averagePrice: number;
  foundAt: string;
  /** Username of whoever tracked it first. Null if that account is gone. */
  finder: string | null;
  foundByMe: boolean;
  isTracking: boolean;
  product: {
    id: string;
    retailer: string;
    retailerId: string;
    title: string;
    imageUrl: string | null;
    url: string;
    currentPrice: number | null;
  };
}

export function getDeals() {
  return request<{ deals: Deal[]; isGuest: boolean }>("/deals");
}

// ---- XP + leaderboard ----

export interface LeaderboardEntry {
  rank: number;
  name: string;
  xp: number;
  level: number;
  title: string;
  isMe: boolean;
}

export interface LeaderboardMe {
  rank: number;
  name: string;
  xp: number;
  hasUsername: boolean;
  offList: boolean;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
  title: string;
}

export function getLeaderboard() {
  return request<{ entries: LeaderboardEntry[]; me: LeaderboardMe | null }>(
    "/leaderboard",
  );
}

export interface Badge {
  id: string;
  label: string;
  description: string;
  icon: string;
  tier: "bronze" | "silver" | "gold";
  earned: boolean;
  progress: number;
  progressLabel: string;
}

export interface XpEntry {
  id: string;
  xp: number;
  reason: string;
  detail: string | null;
  productTitle: string | null;
  at: string;
}

export function getMyXp() {
  return request<{
    username: string | null;
    name: string;
    xp: number;
    level: number;
    currentLevelXp: number;
    nextLevelXp: number;
    progress: number;
    title: string;
    badges: Badge[];
    history: XpEntry[];
  }>("/me/xp");
}

export function setUsername(username: string) {
  return request<{ username: string }>("/me/username", {
    method: "PUT",
    body: { username },
  });
}

export function getRetailerStatus() {
  return request<{
    retailers: {
      retailer: string;
      label: string;
      available: boolean;
      successRate: number | null;
    }[];
  }>("/search/retailers");
}

// ---- budget -----------------------------------------------------------------

export interface BudgetEntry {
  id: string;
  amount: number;
  category: string;
  description: string | null;
  spentAt: string;
  /** Set when the entry was logged from a tracked product. */
  product: {
    id: string;
    title: string;
    retailer: string;
    imageUrl: string | null;
    url: string;
  } | null;
}

export interface BudgetMonth {
  month: string;
  total: number;
  /** The overall monthly budget, or null if none is set. */
  budget: number | null;
  entries: BudgetEntry[];
  categories: { category: string; spent: number; limit: number | null }[];
  limits: {
    canSetCategoryLimits: boolean;
    canUseCustomCategories: boolean;
    canExport: boolean;
    historyMonths: number | null;
    earliestMonth: string | null;
  };
  availableCategories: string[];
  tier: string;
}

export function getBudget(month?: string) {
  return request<BudgetMonth>(`/budget${month ? `?month=${month}` : ""}`);
}

export function addBudgetEntry(entry: {
  amount: number;
  category: string;
  description?: string | null;
  spentAt?: string;
  productId?: string;
}) {
  return request<{ entry: BudgetEntry }>("/budget", { method: "POST", body: entry });
}

export function updateBudgetEntry(
  id: string,
  changes: { amount?: number; category?: string; description?: string | null; spentAt?: string },
) {
  return request<{ ok: true }>(`/budget/${id}`, { method: "PATCH", body: changes });
}

export function deleteBudgetEntry(id: string) {
  return request<{ ok: true }>(`/budget/${id}`, { method: "DELETE" });
}

/** `category: null` sets the overall monthly budget. `amount: null` clears it. */
export function setBudgetLimit(category: string | null, amount: number | null) {
  return request<{ ok: true; category: string | null; amount: number | null }>(
    "/budget/limits",
    { method: "PUT", body: { category, amount } },
  );
}

/** What to prefill the "I bought this" sheet with for a tracked product. */
export function getBudgetPrefill(productId: string) {
  return request<{
    productId: string;
    amount: number | null;
    category: string;
    description: string;
  }>(`/budget/prefill/${productId}`);
}

// ---- "Sweep this deal" -------------------------------------------------------

export type SaleVerdict =
  | "genuine-low"
  | "good-price"
  | "typical-price"
  | "above-usual"
  | "no-history";

export interface SweepAlternative {
  retailer: string;
  retailerLabel: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: number;
  /** "same" is a confident like-for-like; "similar" is explicitly not claimed. */
  confidence: "same" | "similar";
  savings: number;
  caveats: string[];
}

export interface SweepResult {
  product: {
    id: string;
    title: string;
    retailer: string;
    retailerLabel: string;
    url: string;
    imageUrl: string | null;
    price: number;
    listPrice: number | null;
  };
  sale: {
    verdict: SaleVerdict;
    headline: string;
    detail: string;
    claimedPercentOff: number | null;
    realPercentBelowTypical: number | null;
  };
  history: {
    points: number;
    low: number | null;
    high: number | null;
    average: number | null;
    firstSeen: string | null;
  };
  cheaperElsewhere: SweepAlternative[];
  similar: SweepAlternative[];
  unreachable: string[];
  bestSaving: number;
  headline: string;
}

export interface SweepQuota {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
  available: boolean;
}

export function getSweepQuota() {
  return request<{ quota: SweepQuota; tier: string }>("/sweep/quota");
}

export function sweepDeal(
  target: { productId: string } | { url: string } | { retailer: string; retailerId: string },
) {
  return request<{ result: SweepResult; quota: SweepQuota; tier: string }>("/sweep", {
    method: "POST",
    body: target,
  });
}

// ---- deal radar --------------------------------------------------------------

export interface SavedSearch {
  id: string;
  keyword: string;
  targetPrice: number | null;
  createdAt: string;
  lastCheckedAt: string | null;
  lastBestPrice: number | null;
  lastMatchAt: string | null;
  nextCheckAt: string;
  unchangedChecks: number;
}

export interface RadarMatch {
  retailer: string;
  retailerLabel: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: number;
  listPrice: number | null;
  rating: number | null;
  ratingCount: number | null;
}

export interface RadarRefreshes {
  used: number;
  /** Null means unlimited. */
  limit: number | null;
  remaining: number | null;
  resetsAt: string;
}

export function getRadar() {
  return request<{
    searches: SavedSearch[];
    limits: {
      maxSavedSearches: number;
      used: number;
      intervalMinutes: number;
      /** False on free — radars only run when the user refreshes them. */
      autoChecks: boolean;
    };
    refreshes: RadarRefreshes | null;
    tier: string;
  }>("/radar");
}

export function createRadar(keyword: string, targetPrice: number | null) {
  return request<{ search: SavedSearch }>("/radar", {
    method: "POST",
    body: { keyword, targetPrice },
  });
}

export function updateRadar(
  id: string,
  changes: { keyword?: string; targetPrice?: number | null },
) {
  return request<{ ok: true }>(`/radar/${id}`, { method: "PATCH", body: changes });
}

export function deleteRadar(id: string) {
  return request<{ ok: true }>(`/radar/${id}`, { method: "DELETE" });
}

export function refreshRadar(id: string) {
  return request<{
    matches: RadarMatch[];
    best: RadarMatch | null;
    unreachable: string[];
    isNewBest: boolean;
    refreshes: RadarRefreshes | null;
  }>(`/radar/${id}/refresh`, { method: "POST" });
}
