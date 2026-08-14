// lib/matching.ts
//
// Deciding whether two listings are the same product.
//
// No retailer we scrape publishes a UPC or GTIN, so this works from titles.
// That means every match is a judgement, and the cost of the two mistakes is
// wildly asymmetric:
//
//   - Miss a real match: the user doesn't learn about $14 of savings.
//   - Claim a false match: we told someone to buy the 64GB thinking it was the
//     256GB, or a refurb thinking it was new. They find out after paying.
//
// The second is unrecoverable, so the bar for saying "same product" is high and
// everything else is labelled "similar" and shown with its title and image so
// the person can judge. We never say "same" on a guess.
/** Words that carry no identifying information and only dilute the overlap. */
const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "with", "for", "new", "in", "of", "by", "to", "on",
    "free", "shipping", "sale", "deal", "best", "great", "pack", "size", "color", "colour",
]);
/**
 * Conditions that make a listing NOT the same purchase even when the model is
 * identical. eBay especially is full of these, and they're exactly why a naive
 * "cheapest wins" comparison is dangerous.
 */
const CONDITION_FLAGS = [
    "refurbished", "refurb", "renewed", "pre-owned", "preowned", "used", "open box",
    "open-box", "for parts", "damaged", "cracked", "as is", "read description",
];
/** Multi-unit listings, which look cheaper per listing but aren't comparable. */
const PACK_PATTERN = /(\d+)\s*[-\s]?(?:pack|pk|count|ct|pcs|pieces|bundle)\b/i;
function normalize(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s.-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function tokens(title) {
    return normalize(title)
        .split(" ")
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}
/**
 * Tokens that pin down WHICH variant this is — model numbers, capacities,
 * sizes. "wh-1000xm5", "256gb", "13.6".
 *
 * These matter far more than ordinary words: two listings sharing every word
 * except the capacity are different products, and a plain word-overlap score
 * would rate them near-identical.
 */
function modelTokens(title) {
    return new Set(tokens(title).filter((t) => /\d/.test(t) && t.length >= 2));
}
function jaccard(a, b) {
    if (a.size === 0 && b.size === 0)
        return 1;
    let shared = 0;
    for (const item of a)
        if (b.has(item))
            shared++;
    return shared / (a.size + b.size - shared);
}
function conditionsIn(title) {
    const lower = title.toLowerCase();
    return CONDITION_FLAGS.filter((flag) => lower.includes(flag));
}
function packSize(title) {
    const match = title.match(PACK_PATTERN);
    return match ? Number(match[1]) : 1;
}
/**
 * Compare a candidate listing against the product being swept.
 *
 * Scoring is weighted toward the variant markers rather than overall wordiness,
 * because retailers pad titles differently — Walmart writes paragraphs, Best
 * Buy writes four words — and generic overlap mostly measures that padding.
 */
export function compareProducts(source, candidate) {
    const sourceWords = new Set(tokens(source.title));
    const candidateWords = new Set(tokens(candidate.title));
    const sourceModels = modelTokens(source.title);
    const candidateModels = modelTokens(candidate.title);
    const wordScore = jaccard(sourceWords, candidateWords);
    // Brand is the first meaningful word and is close to a hard requirement:
    // "Sony headphones" and "Bose headphones" share plenty of words otherwise.
    const sourceBrand = [...sourceWords][0];
    const brandMatches = sourceBrand ? candidateWords.has(sourceBrand) : false;
    // A model mismatch is disqualifying, not merely a lower score. Sharing zero
    // model tokens when both sides have them means different variants.
    let modelScore;
    if (sourceModels.size === 0 && candidateModels.size === 0) {
        modelScore = 0.5; // Neither side is specific; fall back to words.
    }
    else {
        modelScore = jaccard(sourceModels, candidateModels);
    }
    const score = 0.3 * wordScore + 0.5 * modelScore + (brandMatches ? 0.2 : 0);
    const caveats = [];
    const sourceConditions = conditionsIn(source.title);
    const candidateConditions = conditionsIn(candidate.title);
    const conditionDiffers = candidateConditions.length > 0 && sourceConditions.length === 0;
    if (conditionDiffers) {
        caveats.push(`Listed as ${candidateConditions[0]} — not a like-for-like swap.`);
    }
    const sourcePack = packSize(source.title);
    const candidatePack = packSize(candidate.title);
    if (sourcePack !== candidatePack) {
        caveats.push(`Sold as a ${candidatePack}-pack, not a single item.`);
    }
    if (!brandMatches && sourceBrand) {
        caveats.push("Different brand.");
    }
    if (sourceModels.size > 0 && candidateModels.size > 0 && modelScore < 0.5) {
        caveats.push("Model or size may differ — check before buying.");
    }
    // "Same" requires a strong score AND nothing that changes what you receive.
    // A refurb of the identical model is still not the same purchase.
    const blocking = conditionDiffers || sourcePack !== candidatePack || !brandMatches;
    let confidence;
    if (score >= 0.72 && !blocking)
        confidence = "same";
    else if (score >= 0.4)
        confidence = "similar";
    else
        confidence = "unrelated";
    return { confidence, score: Math.round(score * 100) / 100, caveats };
}
/**
 * A short query for finding this product at other stores.
 *
 * Long titles measurably hurt retailer relevance — we learned this the hard way
 * with Best Buy, where feeding a product's own full name made it drop out of
 * its own search results. Brand plus model markers is what identifies it.
 */
export function searchKeyFor(title) {
    const all = tokens(title);
    const models = all.filter((t) => /\d/.test(t) && t.length >= 2);
    const words = all.filter((t) => !/\d/.test(t)).slice(0, 4);
    return [...words, ...models.slice(0, 2)].join(" ").slice(0, 60);
}
