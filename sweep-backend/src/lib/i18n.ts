// lib/i18n.ts
//
// Server-side strings, localised per request.
//
// The app translates its own copy, so why does the server need any? Two reasons
// it can't be avoided:
//
//   1. The plans screen is entirely generated here — feature lines, upgrade
//      dials, tier summaries — precisely so pricing copy can't drift from the
//      limits actually enforced. Moving that text into the app to translate it
//      would undo the guarantee it exists for.
//   2. Ninety-odd error messages are written here, and only some carry a
//      machine-readable code. Mapping every one client-side means adding codes
//      to all of them and keeping two lists in step forever.
//
// So the client sends Accept-Language and the server answers in kind. One
// translation file per language instead of two.

export type Locale = "en" | "es";

const STRINGS = {
  en: {
    // ---- plan feature lines ----
    "plan.trackProducts": "Track {count} products",
    "plan.checkedTimes": "Checked up to {count}× a day",
    "plan.checkedHours": "Checked up to every {hours} hours",
    "plan.checkedHourly": "Checked up to hourly",
    "plan.checkedMinutes": "Checked up to every {minutes} minutes",
    "plan.historyDays": "{days}-day price history",
    "plan.historyFull": "Full price history",
    "plan.adaptive": "Checked more often while a price is actually moving",
    "plan.dailyFloor": "Every tracked item checked at least once a day, guaranteed",
    "plan.manualChecks": "{count} manual price checks a day",
    "plan.manualCooldown": "Manual checks every {minutes} minutes",
    "plan.manualUnlimited": "Unlimited manual price checks",
    "plan.dropAlerts": "Price-drop alerts",
    "plan.thresholds": "Custom alert thresholds (“only below $X”)",
    "plan.priorityQueue": "Priority check queue",
    "plan.searches": "{count} multi-store searches a day",
    "plan.searchesOne": "{count} multi-store search a day",
    "plan.compareAll": "Compare every store at once",
    "plan.history": "Reopen your last {count} searches, free",
    "plan.resultsFixed": "{count} results per store",
    "plan.resultsChoose": "Choose {min}–{max} results per store",
    "plan.noAds": "No ads",
    "plan.lookupCount": "Look up any product {count}× a day",
    "plan.lookupNone": "Product lookup — ratings, real reviews and shipping, on one page",
    "plan.radarCount": "Deal Radar — watch {count} searches for a price you name",
    "plan.radarCountOne": "Deal Radar — watch {count} search for a price you name",
    "plan.radarAuto": "Radars checked for you, up to every {hours} hours",
    "plan.radarManual": "Radars checked automatically (you refresh them yourself)",
    "plan.budgetLogging": "Unlimited expense logging",
    "plan.budgetMonths": "{months} months of spending history",
    "plan.budgetFull": "Full spending history",
    "plan.budgetOverall": "Monthly budget with overspend warnings",
    "plan.budgetCategories": "Custom categories",
    "plan.budgetLimits": "Per-category limits",
    "plan.budgetExport": "Export to CSV",
    "plan.lists": "{lists} lists, {items} items each",
    "plan.listsOne": "{lists} list, {items} items each",
    "plan.shareLinks": "Shareable gift links",
    "plan.xp": "XP, badges and leaderboard",
    "plan.dealsFeed": "Best Deals Found feed",

    // ---- plan names and taglines ----
    "plan.free.name": "Free",
    "plan.free.tagline": "Everything you need to start saving",
    "plan.pro.name": "Pro",
    "plan.pro.tagline": "For people who shop deliberately",
    "plan.ultimate.name": "Ultimate",
    "plan.ultimate.tagline": "Every price, checked constantly",
    "plan.badge.popular": "MOST POPULAR",
    "plan.badge.value": "BEST VALUE",

    // ---- upgrade dial labels ----
    "dial.products": "Products tracked",
    "dial.checks": "Price checks",
    "dial.searches": "Searches a day",
    "dial.reopen": "Searches you can reopen",
    "dial.manual": "Manual checks",
    "dial.results": "Results per store",
    "dial.radar": "Deal Radar",
    "dial.lookup": "Product lookups",
    "dial.history": "Price history",
    "dial.lists": "Lists",
    "dial.forever": "Forever",
    "dial.days": "{days} days",
    "dial.unlimited": "Unlimited",
    "dial.perDay": "{count} a day",
    "dial.everyMinutes": "Every {minutes} min",
    "dial.upToHourly": "Up to hourly",
    "dial.upToHours": "Up to every {hours} hours",
    "dial.upToMinutes": "Up to every {minutes} min",
    "dial.upToTimes": "Up to {count}× a day",
    "dial.listsValue": "{lists} × {items} items",
    "dial.radarManual": "{count}, manual",
    "dial.radarAuto": "{count}, up to every {hours}h",
    "dial.resultsChoice": "up to {max}, your choice",
    "dial.none": "—",

    // ---- errors the app shows verbatim ----
    "err.noWallet": "No wallet for user",
    "err.searchLimit": "You've used all your searches for today.",
    "err.guestSearchLimit": "Guests get one search a day. Sign up for more.",
    "err.networkLimit":
      "This network has used its guest searches for today. Sign up for your own allowance.",
    "err.trackLimit": "Your plan tracks up to {limit} products.",
    "err.listLimit": "Your plan allows {limit} lists.",
    "err.listLimitOne": "Your plan allows {limit} list.",
    "err.listItemLimit": "Lists hold {limit} items on your plan.",
    "err.radarLimit": "Your plan watches {limit} searches at a time.",
    "err.radarLimitOne": "Your plan watches {limit} search at a time.",
    "err.radarRefreshGone": "That's your {limit} refreshes for today.",
    "err.radarChangeGone":
      "You've set up {limit} radars today. Try again tomorrow, or refresh the ones you have.",
    "err.sweepTier": "Sweep this deal is a Pro and Ultimate feature.",
    "err.sweepGoneOne": "That's your sweep for today. Ultimate gets three.",
    "err.sweepGone": "You've used all your sweeps today.",
    "err.categoryTier": "Custom categories are a Pro feature.",
    "err.categoryLimitTier":
      "Per-category limits are a Pro feature. Your overall monthly budget still works.",
    "err.exportTier": "Exporting is a Pro feature.",
    "err.historyLimit": "Your plan keeps {months} months of spending history.",
    "err.historyLimitOne": "Your plan shows the current month.",
    "err.retailerDisabled": "Sweep can't reach {store} at the moment. Try another store.",
    "err.unsupportedStore": "Sweep doesn't support {host} yet. Try {stores}.",
    "err.invalidUrl": "That doesn't look like a product link.",
    "err.storeBlocked": "That store is blocking price checks right now. Try again later.",
    "err.scrapeFailed": "Couldn't read that product page right now. Try again in a moment.",
    "err.rateLimited": "Too many requests. Try again in {seconds}s.",
    "err.generic": "Something went wrong. Try again.",
    "err.passwordRequired": "Enter your password to delete your account.",
    "err.passwordWrong": "That password isn't right.",
    "err.needAmount": "Enter an amount greater than zero.",
    "err.needCategory": "Pick a category.",
    "err.badDate": "That date doesn't look right.",
    "err.badMonth": "Month should look like 2026-08.",
    "err.needKeyword": "What should Sweep watch for?",
    "err.badTarget": "That target price doesn't look right.",
    "err.needName": "Give the list a name.",
    "err.noPrice": "That item has no price right now, so there's nothing to compare.",

    // ---- notifications ----
    "push.dropTitle": "{title}",
    "push.dropBody": "Down {percent}% to {price} (was {was}).",
    "push.thresholdBody": "Now {price} — below your {threshold} alert.",
    "push.radarTitle": "Radar: {keyword}",
    "push.radarTarget": "{price} at {store} — under your {target} target.",
    "push.radarBest": "{price} at {store} — the cheapest we've seen.",

    // ---- feature group headings ----
    "group.tracking": "Price tracking",
    "group.search": "Multi-store search",
    "group.budget": "Budget tracker",
    "group.lists": "Lists & wishlists",
    "group.extras": "Community",

    // ---- current-plan summary line ----
    "summary.line": "{products} products · {cadence} · {searches}",
    "summary.cadenceTimes": "checked up to {count}× a day",
    "summary.cadenceHourly": "checked up to hourly",
    "summary.cadenceHours": "checked up to every {hours}h",
    "summary.searches": "{count} searches a day",
    "summary.searchesOne": "{count} search a day",
  },

  es: {
    "plan.trackProducts": "Sigue {count} productos",
    "plan.checkedTimes": "Revisado hasta {count} veces al día",
    "plan.checkedHours": "Revisado hasta cada {hours} horas",
    "plan.checkedHourly": "Revisado hasta cada hora",
    "plan.checkedMinutes": "Revisado hasta cada {minutes} minutos",
    "plan.historyDays": "Historial de precios de {days} días",
    "plan.historyFull": "Historial de precios completo",
    "plan.adaptive": "Se revisa más seguido mientras el precio se mueve",
    "plan.dailyFloor": "Cada producto seguido se revisa al menos una vez al día, garantizado",
    "plan.manualChecks": "{count} revisiones manuales al día",
    "plan.manualCooldown": "Revisiones manuales cada {minutes} minutos",
    "plan.manualUnlimited": "Revisiones manuales ilimitadas",
    "plan.dropAlerts": "Alertas de bajada de precio",
    "plan.thresholds": "Alertas personalizadas («solo por debajo de $X»)",
    "plan.priorityQueue": "Cola de revisión prioritaria",
    "plan.searches": "{count} búsquedas multitienda al día",
    "plan.searchesOne": "{count} búsqueda multitienda al día",
    "plan.compareAll": "Compara todas las tiendas a la vez",
    "plan.history": "Reabre tus últimas {count} búsquedas, gratis",
    "plan.resultsFixed": "{count} resultados por tienda",
    "plan.resultsChoose": "Elige de {min} a {max} resultados por tienda",
    "plan.noAds": "Sin anuncios",
    "plan.lookupCount": "Consulta cualquier producto {count} veces al día",
    "plan.lookupNone": "Consulta de productos: valoraciones, opiniones reales y envío, en una sola página",
    "plan.radarCount": "Radar de Ofertas — vigila {count} búsquedas al precio que digas",
    "plan.radarCountOne": "Radar de Ofertas — vigila {count} búsqueda al precio que digas",
    "plan.radarAuto": "Radares revisados por ti, hasta cada {hours} horas",
    "plan.radarManual": "Radares revisados automáticamente (los actualizas tú)",
    "plan.budgetLogging": "Registro de gastos ilimitado",
    "plan.budgetMonths": "{months} meses de historial de gastos",
    "plan.budgetFull": "Historial de gastos completo",
    "plan.budgetOverall": "Presupuesto mensual con avisos de exceso",
    "plan.budgetCategories": "Categorías personalizadas",
    "plan.budgetLimits": "Límites por categoría",
    "plan.budgetExport": "Exportar a CSV",
    "plan.lists": "{lists} listas, {items} artículos cada una",
    "plan.listsOne": "{lists} lista, {items} artículos",
    "plan.shareLinks": "Enlaces de regalo para compartir",
    "plan.xp": "XP, insignias y clasificación",
    "plan.dealsFeed": "Feed de mejores ofertas encontradas",

    "plan.free.name": "Gratis",
    "plan.free.tagline": "Todo lo necesario para empezar a ahorrar",
    "plan.pro.name": "Pro",
    "plan.pro.tagline": "Para quien compra con cabeza",
    "plan.ultimate.name": "Ultimate",
    "plan.ultimate.tagline": "Todos los precios, revisados constantemente",
    "plan.badge.popular": "MÁS POPULAR",
    "plan.badge.value": "MEJOR VALOR",

    "dial.products": "Productos seguidos",
    "dial.checks": "Revisiones de precio",
    "dial.searches": "Búsquedas al día",
    "dial.reopen": "Búsquedas que puedes reabrir",
    "dial.manual": "Revisiones manuales",
    "dial.results": "Resultados por tienda",
    "dial.radar": "Radar de Ofertas",
    "dial.lookup": "Consultas de producto",
    "dial.history": "Historial de precios",
    "dial.lists": "Listas",
    "dial.forever": "Para siempre",
    "dial.days": "{days} días",
    "dial.unlimited": "Ilimitadas",
    "dial.perDay": "{count} al día",
    "dial.everyMinutes": "Cada {minutes} min",
    "dial.upToHourly": "Hasta cada hora",
    "dial.upToHours": "Hasta cada {hours} horas",
    "dial.upToMinutes": "Hasta cada {minutes} min",
    "dial.upToTimes": "Hasta {count} veces al día",
    "dial.listsValue": "{lists} × {items} artículos",
    "dial.radarManual": "{count}, manual",
    "dial.radarAuto": "{count}, hasta cada {hours}h",
    "dial.resultsChoice": "hasta {max}, tú eliges",
    "dial.none": "—",

    "err.noWallet": "No hay cartera para este usuario",
    "err.searchLimit": "Ya usaste todas tus búsquedas de hoy.",
    "err.guestSearchLimit": "Los invitados tienen una búsqueda al día. Crea una cuenta para más.",
    "err.networkLimit":
      "Esta red ya usó sus búsquedas de invitado de hoy. Crea una cuenta para tener las tuyas.",
    "err.trackLimit": "Tu plan permite seguir hasta {limit} productos.",
    "err.listLimit": "Tu plan permite {limit} listas.",
    "err.listLimitOne": "Tu plan permite {limit} lista.",
    "err.listItemLimit": "Las listas admiten {limit} artículos en tu plan.",
    "err.radarLimit": "Tu plan vigila {limit} búsquedas a la vez.",
    "err.radarLimitOne": "Tu plan vigila {limit} búsqueda a la vez.",
    "err.radarRefreshGone": "Ya usaste tus {limit} actualizaciones de hoy.",
    "err.radarChangeGone":
      "Hoy ya creaste {limit} radares. Inténtalo mañana, o actualiza los que tienes.",
    "err.sweepTier": "«Analizar oferta» es una función de Pro y Ultimate.",
    "err.sweepGoneOne": "Ese era tu análisis de hoy. Ultimate tiene tres.",
    "err.sweepGone": "Ya usaste todos tus análisis de hoy.",
    "err.categoryTier": "Las categorías personalizadas son una función de Pro.",
    "err.categoryLimitTier":
      "Los límites por categoría son una función de Pro. Tu presupuesto mensual sigue funcionando.",
    "err.exportTier": "Exportar es una función de Pro.",
    "err.historyLimit": "Tu plan guarda {months} meses de historial de gastos.",
    "err.historyLimitOne": "Tu plan muestra el mes actual.",
    "err.retailerDisabled": "Ahora mismo Sweep no puede conectar con {store}. Prueba otra tienda.",
    "err.unsupportedStore": "Sweep todavía no admite {host}. Prueba {stores}.",
    "err.invalidUrl": "Eso no parece el enlace de un producto.",
    "err.storeBlocked": "Esa tienda está bloqueando las revisiones de precio. Inténtalo más tarde.",
    "err.scrapeFailed": "No pudimos leer esa página ahora mismo. Inténtalo en un momento.",
    "err.rateLimited": "Demasiadas peticiones. Inténtalo en {seconds}s.",
    "err.generic": "Algo salió mal. Inténtalo de nuevo.",
    "err.passwordRequired": "Escribe tu contraseña para eliminar la cuenta.",
    "err.passwordWrong": "Esa contraseña no es correcta.",
    "err.needAmount": "Escribe un importe mayor que cero.",
    "err.needCategory": "Elige una categoría.",
    "err.badDate": "Esa fecha no parece correcta.",
    "err.badMonth": "El mes debe verse así: 2026-08.",
    "err.needKeyword": "¿Qué quieres que vigile Sweep?",
    "err.badTarget": "Ese precio objetivo no parece correcto.",
    "err.needName": "Ponle nombre a la lista.",
    "err.noPrice": "Ese artículo no tiene precio ahora mismo, así que no hay nada que comparar.",

    "push.dropTitle": "{title}",
    "push.dropBody": "Bajó {percent}% hasta {price} (antes {was}).",
    "push.thresholdBody": "Ahora {price} — por debajo de tu alerta de {threshold}.",
    "push.radarTitle": "Radar: {keyword}",
    "push.radarTarget": "{price} en {store} — por debajo de tu objetivo de {target}.",
    "push.radarBest": "{price} en {store} — el más barato que hemos visto.",

    // ---- feature group headings ----
    "group.tracking": "Seguimiento de precios",
    "group.search": "Búsqueda en varias tiendas",
    "group.budget": "Control de gastos",
    "group.lists": "Listas y favoritos",
    "group.extras": "Comunidad",

    // ---- current-plan summary line ----
    "summary.line": "{products} productos · {cadence} · {searches}",
    "summary.cadenceTimes": "revisados hasta {count}× al día",
    "summary.cadenceHourly": "revisados hasta cada hora",
    "summary.cadenceHours": "revisados hasta cada {hours} h",
    "summary.searches": "{count} búsquedas al día",
    "summary.searchesOne": "{count} búsqueda al día",
  },
} satisfies Record<Locale, Record<string, string>>;

export type StringKey = keyof (typeof STRINGS)["en"];

/**
 * Parse Accept-Language into a locale we support.
 *
 * Deliberately forgiving: browsers and clients send everything from "es" to
 * "es-419,es;q=0.9,en;q=0.8". We only care about the first tag we recognise.
 */
export function localeFrom(header: string | undefined): Locale {
  if (!header) return "en";
  for (const part of header.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase();
    const base = tag?.split("-")[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return "en";
}

/**
 * Look up a string, substituting {name} placeholders.
 *
 * Falls back to English rather than the key. A stray English sentence is a
 * blemish; a raw `err.trackLimit` on someone's screen is a bug report.
 */
export function t(
  locale: Locale,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  let text: string = STRINGS[locale][key] ?? STRINGS.en[key];
  if (text === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** Every key, for the parity test. */
export function allKeys(): StringKey[] {
  return Object.keys(STRINGS.en) as StringKey[];
}

export const LOCALES: Locale[] = ["en", "es"];
export { STRINGS };
