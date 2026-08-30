// lib/liveStores.test.ts — which stores the app is willing to name.
//   npm run test:stores
//
// The app used to write copy from a static list of every retailer it has ever
// had an adapter for, so it told people it searched Best Buy, Newegg and ASOS —
// all switched off. Naming Best Buy while asking Best Buy for API access is a
// particularly bad way to be wrong.
//
// The case that needs the most care is an OLD server, which doesn't send
// `enabled` at all. Absent must mean "no opinion", not "disabled" — read the
// other way, the store list empties and the app says it searches nothing.
import { isOffered, liveStoreNames, setLiveStores, storesInTrouble } from "./liveStores";
import { storeListPhrase } from "./format";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok && detail !== undefined) console.log("     ", JSON.stringify(detail));
};

console.log("\n— before the server answers —");
const fallback = liveStoreNames();
check("falls back to the full list", fallback.length > 0, fallback);
check("the phrase still reads", storeListPhrase(3).length > 0, storeListPhrase(3));

console.log("\n— a modern server —");
setLiveStores([
  { label: "Amazon", enabled: true },
  { label: "Walmart", enabled: true },
  { label: "Best Buy", enabled: false },
  { label: "eBay", enabled: true },
  { label: "Newegg", enabled: false },
  { label: "ASOS", enabled: false },
  { label: "Etsy", enabled: true },
]);
check("keeps only live stores", liveStoreNames().join(",") === "Amazon,Walmart,eBay,Etsy", liveStoreNames());
check("the phrase names no dead store", !storeListPhrase(4).includes("Best Buy"), storeListPhrase(4));
check("four live stores need no 'and more'", !storeListPhrase(4).includes("and more"), storeListPhrase(4));
check("a shorter limit does say 'and more'", storeListPhrase(2).includes("and more"), storeListPhrase(2));

console.log("\n— an older server, which sends no `enabled` —");
setLiveStores([
  { label: "Amazon" },
  { label: "Walmart" },
  { label: "eBay" },
]);
// Absent means no opinion. Treating it as false would empty the list entirely.
check("keeps every store it was given", liveStoreNames().join(",") === "Amazon,Walmart,eBay", liveStoreNames());

console.log("\n— nonsense is ignored rather than believed —");
const before = liveStoreNames().join(",");
setLiveStores(null);
check("null changes nothing", liveStoreNames().join(",") === before);
setLiveStores([]);
check("an empty list changes nothing", liveStoreNames().join(",") === before);
setLiveStores([{ label: "Amazon", enabled: false }]);
check("all-disabled changes nothing", liveStoreNames().join(",") === before, liveStoreNames());

console.log("\n— what counts as a store in trouble —");
const board = [
  { retailer: "amazon", available: true, enabled: true },
  { retailer: "walmart", available: false, enabled: true },   // on, and failing
  { retailer: "bestbuy", available: false, enabled: false },  // we turned it off
  { retailer: "newegg", available: false, enabled: false },
  { retailer: "asos", available: false, enabled: false },
  { retailer: "etsy", available: true, enabled: true },
];
const trouble = storesInTrouble(board);
// The bug this replaced: Home read "3 stores having trouble" permanently,
// because the three we switched off ourselves were counted as outages.
check("only the store that is on and failing", trouble.length === 1, trouble.map((s) => s.retailer));
check("and it is the right one", trouble[0]?.retailer === "walmart", trouble[0]);
check("a healthy board reports nothing",
  storesInTrouble(board.filter((s) => s.enabled !== false).map((s) => ({ ...s, available: true }))).length === 0);

check("isOffered keeps switched-on stores", isOffered({ enabled: true }));
check("isOffered drops switched-off stores", !isOffered({ enabled: false }));
// The old-server case again, at the predicate level this time.
check("isOffered keeps a store with no opinion", isOffered({}));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
