// lib/admobSsv.ts
//
// Verifies AdMob's server-side verification (SSV) callback.
//
// Why this exists: without it, "I watched an ad" is just a claim the client
// makes, and anyone can POST to the reward endpoint to mint free searches for
// themselves. Since a search costs real money on the Amazon leg, that's a hole
// with a bill attached.
//
// How SSV works: when a rewarded ad completes, Google calls a URL you register
// in the AdMob console. The querystring carries the reward details plus an
// ECDSA `signature` over everything before `&signature=`. Google publishes the
// matching public keys at a well-known endpoint, keyed by `key_id`.
//
// Verifying that signature is what turns "the client says so" into proof.
import { createVerify } from "node:crypto";
const KEY_ENDPOINT = "https://gstatic.com/admob/reward/verifier-keys.json";
/** Keys rotate rarely; re-fetching hourly is plenty and keeps startup cheap. */
const KEY_CACHE_TTL_MS = 60 * 60 * 1000;
let cache = null;
async function getVerifierKeys() {
    if (cache && Date.now() - cache.fetchedAt < KEY_CACHE_TTL_MS)
        return cache.keys;
    const res = await fetch(KEY_ENDPOINT, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
        throw new Error(`couldn't fetch AdMob verifier keys: ${res.status}`);
    const body = (await res.json());
    const keys = new Map();
    for (const key of body.keys ?? [])
        keys.set(String(key.keyId), key.pem);
    cache = { keys, fetchedAt: Date.now() };
    return keys;
}
/**
 * Verify a raw SSV callback query string.
 *
 * `rawQuery` must be exactly what Google sent, in the original order —
 * re-serialising from a parsed object can reorder or re-encode parameters and
 * break the signature.
 */
export async function verifySsvCallback(rawQuery) {
    const params = new URLSearchParams(rawQuery);
    const signature = params.get("signature");
    const keyId = params.get("key_id");
    const userId = params.get("user_id");
    const transactionId = params.get("transaction_id");
    if (!signature || !keyId) {
        return { valid: false, reason: "missing signature or key_id" };
    }
    if (!userId) {
        return { valid: false, reason: "missing user_id — set serverSideVerificationOptions on the ad request" };
    }
    if (!transactionId) {
        return { valid: false, reason: "missing transaction_id" };
    }
    // Google signs everything BEFORE "&signature=" — including parameter order,
    // which is why we work from the raw string rather than a rebuilt one.
    const signatureIndex = rawQuery.indexOf("signature=");
    if (signatureIndex <= 0) {
        return { valid: false, reason: "malformed callback: no signature parameter" };
    }
    const signedPortion = rawQuery.slice(0, signatureIndex - 1);
    let pem;
    try {
        pem = (await getVerifierKeys()).get(keyId);
    }
    catch (err) {
        return {
            valid: false,
            reason: `couldn't load verifier keys: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    if (!pem)
        return { valid: false, reason: `unknown key_id ${keyId}` };
    const verifier = createVerify("SHA256");
    verifier.update(signedPortion);
    verifier.end();
    // AdMob sends the signature base64url-encoded.
    const ok = verifier.verify(pem, Buffer.from(signature, "base64url"));
    if (!ok)
        return { valid: false, reason: "signature did not verify" };
    return {
        valid: true,
        userId,
        transactionId,
        amount: Number(params.get("reward_amount") ?? 1),
    };
}
