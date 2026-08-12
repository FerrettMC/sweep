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

export interface SearchResponse {
  keyword: string;
  quota: Quota;
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

export function trackProduct(
  target: { url: string } | { retailer: string; retailerId: string },
) {
  return request<{ tracked: TrackedProduct }>("/products/track", {
    method: "POST",
    body: target,
  });
}

export function untrackProduct(trackedId: string) {
  return request<{ ok: true }>(`/products/track/${trackedId}`, {
    method: "DELETE",
  });
}

export function getProductDetail(productId: string) {
  return request<ProductDetail>(`/products/${productId}`);
}

export function refreshProduct(productId: string) {
  return request<{ status: string; product: Product | null }>(
    `/products/${productId}/refresh`,
    { method: "POST" },
  );
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
