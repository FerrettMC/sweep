// lib/i18n/translations.ts
//
// Every string a user reads in the app.
//
// Kept in one file per language rather than colocated with screens so a
// translator can work through it without opening React, and so a missing key
// is visible by comparing two objects instead of hunting thirty files.
//
// Keys are namespaced by screen. Interpolation uses {{name}}, matching i18n-js.
//
// Server-generated copy is NOT here — plan features, tier summaries and error
// messages are translated by the backend and arrive already localised. See
// sweep-backend/src/lib/i18n.ts for why.

// Not `as const`: literal types would make every English string its own type,
// and Spanish could never satisfy the same shape. The keys are still checked —
// a missing or misspelled one fails to compile.
export const en = {
  common: {
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    delete: "Delete",
    done: "Done",
    retry: "Try again",
    loading: "Loading…",
    free: "Free",
    perStore: "{{count}} per store",
    searchesLeft: "{{count}} searches left today",
    searchLeft: "{{count}} search left today",
    noSearchesLeft: "No searches left today",
  },

  tabs: {
    home: "Home",
    search: "Search",
    tracking: "Tracking",
    deals: "Deals",
  },

  onboarding: {
    skip: "Skip",
    next: "Next",
    getStarted: "Get started",
    haveAccount: "I already have an account",
    welcomeEyebrow: "WELCOME",
    welcomeTitle: "Sweep",
    welcomeBody:
      "Your online shopping buddy. It finds the best price, watches it for you, and tells you when a sale is actually a sale.",
    findEyebrow: "FIND IT",
    findTitle: "Every store, one search",
    watchEyebrow: "WATCH IT",
    watchTitle: "Never refresh a page again",
    watchBody:
      "Track something and Sweep checks it for you. Or set a Deal Radar — name a thing and a price, and it keeps looking until it finds one.",
    judgeEyebrow: "JUDGE IT",
    judgeTitle: "Is that sale even real?",
    judgeBody:
      "Sweep keeps its own price history, so it can tell you when a big red discount badge is sitting on the price the item always costs.",
    planEyebrow: "PLAN IT",
    planTitle: "Lists and a budget",
    planBody:
      "Save things to shareable lists for birthdays and holidays, and log what you spend so the month doesn't surprise you.",
    freeEyebrow: "THE HONEST BIT",
    freeTitle: "Free, genuinely",
    freeBody:
      "Every store, real alerts and a working budget cost nothing. Paid plans raise the limits and check more often — that's the whole difference.",
    freeNote: "No card, no trial, no expiry.",
    language: "Language",
  },

  auth: {
    tagline: "Sweep — your online shopping buddy",
    email: "Email",
    password: "Password",
    signUp: "Sign Up",
    logIn: "Log In",
    forgot: "Forgot your password?",
    continueAsGuest: "Continue as guest",
    checkEmail: "Check your email to confirm your account, then log in.",
    badCredentials:
      "Email or password is incorrect. Try 'Forgot your password?' below.",
    notConfirmed: "Confirm your email first — check your inbox for the link.",
    needBoth: "Enter an email and password.",
  },

  reset: {
    title: "Reset your password",
    checkTitle: "Check your email",
    intro: "We'll email you a code. It's valid for one hour.",
    sent: "If there's an account for {{email}}, a code is on its way. Enter it below with your new password.",
    codePlaceholder: "Code from email",
    newPassword: "New password (8+ characters)",
    sendCode: "Send code",
    changePassword: "Change password",
    sendAnother: "Send another code",
    enterEmail: "Enter the email you signed up with.",
    enterCode: "Enter the full code from the email.",
    tooShort: "Passwords need at least 8 characters.",
    badCode: "That code didn't work. It may have expired — send a new one.",
    done: "Password changed. You're signed in.",
  },

  home: {
    yourPlan: "YOUR PLAN",
    notConfirmed: "Not confirmed",
    seeUpgrades: "See upgrades",
    shortcuts: "Shortcuts",
    budget: "Budget",
    budgetHint: "Track spending",
    radar: "Deal Radar",
    radarHint: "Watch for a price",
    lists: "Lists",
    listsHint: "Gift & wishlists",
    leaderboard: "Leaderboard",
    createAccount: "Create an account",
    alertsOff: "Price alerts are off",
    alertsOffBody: "You won't hear about a drop while it's still live.",
    storeDownOne: "{{store}} is unavailable",
    storeDownMany: "{{count}} stores are unavailable",
    storeDisabled:
      "We can't reach {{stores}} from our servers right now. We're working on it — everything else is searching normally.",
    storeFailing:
      "{{stores}} is having trouble. This is usually temporary and fixes itself; the other stores are unaffected.",
  },

  search: {
    placeholder: "Search every store at once…",
    button: "Search",
    topPicks: "Top picks",
    byStore: "By store",
    compare: "Compare",
    added: "Added",
    list: "List",
    open: "Open",
    sweep: "Sweep",
    bought: "Bought",
    edit: "Edit",
    resultsPerStore: "Results per store",
    resultsHelp: "How many items each store returns. Fewer comes back faster.",
    fastest: "fastest",
    thorough: "most thorough",
    skipped: "Skipped {{stores}} — they don't sell this kind of thing.",
    amazonPending: "Amazon is still loading — it can take up to 3 minutes.",
    watchAd: "Watch ad for +1",
  },

  radar: {
    searchLabel: "Search",
    searchMeans: "you look, once, right now",
    radarLabel: "Radar",
    radarMeans: "Sweep keeps looking, for weeks",
    autoChecks:
      "Sweep re-runs these on its own, up to every {{hours}} hours, and notifies you when something beats the best price it has found so far.",
    manualChecks:
      "On your plan radars run when you tap Refresh — {{count}} times a day. Pro and Ultimate re-run them in the background and send a notification.",
    whatFor: "What are you looking for?",
    targetPrice: "Target price (optional)",
    watch: "Watch",
    refresh: "Refresh",
    checking: "Checking every store…",
    noneLeft: "No refreshes left today",
    left: "{{count}} left",
    empty: "Nothing on the radar",
    emptyBody:
      "Add something above — 'airpods pro' under $180, say — and Sweep will look for it across every store.",
    under: "under {{price}}",
    anyPrice: "any notable price",
    bestSeen: "Best seen: {{price}}",
    noMatch: "Nothing under your target right now.",
    stopWatching: "Stop watching this?",
    stopBody: "Sweep will no longer look for it.",
  },

  tracking: {
    empty: "Nothing tracked yet",
    sameAsStart: "Same as when you started ({{price}})",
    downSince: "Down {{amount}} since you started",
    upSince: "Up {{amount}} since you started",
    limitReached: "Limit reached",
    tracked: "{{used}} of {{limit}} tracked",
    stopTracking: "Stop tracking",
    keepTracking: "Keep tracking",
    loggedIt: "Added to your budget",
    stopToo: "Want to stop watching its price as well?",
  },

  budget: {
    spentThisMonth: "SPENT THIS MONTH",
    setBudget: "Set a monthly budget",
    leftOf: "{{amount}} left of {{budget}}",
    overBudget: "{{amount}} over your {{budget}} budget",
    whereItWent: "Where it went",
    logPurchase: "Log a purchase",
    logThis: "Log this purchase",
    editPurchase: "Edit purchase",
    amount: "Amount",
    category: "Category",
    note: "Note (optional)",
    whatWasIt: "What was it?",
    logIt: "Log it",
    newCategory: "New",
    categoryName: "Category name…",
    nothingLogged: "Nothing logged yet",
    nothingBody:
      "Log what you spend and it'll add up here. Bought something you were tracking? There's a button on it.",
    hint: "Tap an entry to edit it, hold to delete.",
    deleteTitle: "Delete this purchase?",
    perCategoryPro: "Set a limit per category with Pro",
  },

  lists: {
    title: "Lists",
    newList: "New list name…",
    create: "Create",
    addToList: "Add to a list",
    alreadyOn: "Already on this list",
    full: "Full ({{limit}} items)",
    items: "{{count}} items",
    noLists:
      "You don't have any lists yet. Name one below and this product goes straight onto it.",
    empty: "Nothing on this list yet. Paste a product link below.",
    share: "Share",
    unshare: "Stop sharing",
    openItem: "Open",
  },

  sweep: {
    title: "SWEEP THIS DEAL",
    checking: "Checking every other store and this item's price history…",
    takesSeconds: "This takes a few seconds.",
    remaining: "{{count}} left today",
    storeClaims: "STORE CLAIMS",
    actually: "ACTUALLY",
    percentOff: "{{percent}}% off",
    normalPrice: "its normal price",
    belowUsual: "{{percent}}% below usual",
    cheaperElsewhere: "Cheaper elsewhere",
    worthALook: "Worth a look",
    worthALookBody:
      "These cost less but we're not certain they're identical — check the details before buying.",
    nothingCheaper: "Nothing cheaper found at any other store.",
    priceHistory: "Its price history",
    now: "Now",
    lowest: "Lowest",
    typical: "Typical",
    checks: "Checks",
    save: "save {{amount}}",
    unreachable:
      "Couldn't reach {{stores}} this time — there may be cheaper options there.",
  },

  profile: {
    account: "Account",
    plan: "Plan",
    comparePlans: "Compare plans",
    seeIncluded: "See what's included",
    planUnknown: "Can't reach Sweep right now, so your plan isn't confirmed.",
    appearance: "Appearance",
    appearanceHint: "System follows your phone, so it switches when your phone does.",
    system: "System",
    light: "Light",
    dark: "Dark",
    language: "Language",
    languageHint: "Changes everything you read in Sweep.",
    priceAlerts: "Price alerts",
    enableAlerts: "Enable price alerts",
    storeStatus: "Store status",
    storeStatusHint: "Which stores Sweep can currently read prices from.",
    working: "Working",
    unavailable: "Unavailable",
    help: "Help",
    emailSupport: "Email support",
    privacy: "Privacy policy",
    privacyHint: "What Sweep stores, and why",
    replayTour: "Replay the tour",
    replayHint: "See how Sweep works again",
    version: "Version",
    signOut: "Sign out",
    deleteAccount: "Delete my account",
    deleteTitle: "Delete your account?",
    deleteBody:
      "This erases your tracked products, lists, budget, radars and XP. It cannot be undone.",
    deleteConfirm: "Delete forever",
    deleteKeep: "Keep my account",
    yourPassword: "Your password",
    enterPassword: "Enter your password to confirm.",
    thisAccount: "This account",
    changeUsername: "Change",
  },

  offline: {
    banner:
      "No connection — Sweep needs internet for prices, and anything on screen may be out of date.",
  },

  error: {
    title: "That didn't go to plan",
    body: "Something in Sweep hit an error. Your tracked products, lists and budget are all stored on our servers, so nothing has been lost.",
    tellUs: "Tell us what happened",
  },
};

/** The shape every language must provide. */
export type Translations = typeof en;

/**
 * Spanish. Deliberately not a word-for-word rendering of the English:
 *
 *   - "Sweep this deal" becomes "Analizar oferta" — the English is a pun on the
 *     product name that doesn't survive translation, and a literal "barrer"
 *     would read as cleaning the floor.
 *   - Prices and counts stay in the interpolation so number formatting is left
 *     to the caller rather than baked into a sentence.
 *   - Formal "usted" is avoided throughout; a shopping app that addresses you
 *     formally reads as a bank.
 */
export const es: Translations = {
  common: {
    cancel: "Cancelar",
    close: "Cerrar",
    save: "Guardar",
    delete: "Eliminar",
    done: "Listo",
    retry: "Reintentar",
    loading: "Cargando…",
    free: "Gratis",
    perStore: "{{count}} por tienda",
    searchesLeft: "Te quedan {{count}} búsquedas hoy",
    searchLeft: "Te queda {{count}} búsqueda hoy",
    noSearchesLeft: "No te quedan búsquedas hoy",
  },

  tabs: {
    home: "Inicio",
    search: "Buscar",
    tracking: "Seguimiento",
    deals: "Ofertas",
  },

  onboarding: {
    skip: "Saltar",
    next: "Siguiente",
    getStarted: "Empezar",
    haveAccount: "Ya tengo una cuenta",
    welcomeEyebrow: "BIENVENIDO",
    welcomeTitle: "Sweep",
    welcomeBody:
      "Tu compañero de compras online. Encuentra el mejor precio, lo vigila por ti y te dice cuándo una oferta es de verdad.",
    findEyebrow: "ENCUÉNTRALO",
    findTitle: "Todas las tiendas, una búsqueda",
    watchEyebrow: "VIGÍLALO",
    watchTitle: "No vuelvas a recargar una página",
    watchBody:
      "Sigue un producto y Sweep lo revisa por ti. O crea un Radar de Ofertas: di qué quieres y a qué precio, y seguirá buscando hasta encontrarlo.",
    judgeEyebrow: "JÚZGALO",
    judgeTitle: "¿Esa oferta es real?",
    judgeBody:
      "Sweep guarda su propio historial de precios, así que puede decirte cuándo ese descuento enorme está sobre el precio de siempre.",
    planEyebrow: "ORGANÍZALO",
    planTitle: "Listas y presupuesto",
    planBody:
      "Guarda cosas en listas que puedes compartir para cumpleaños y fiestas, y anota lo que gastas para que el mes no te sorprenda.",
    freeEyebrow: "LO IMPORTANTE",
    freeTitle: "Gratis, de verdad",
    freeBody:
      "Todas las tiendas, alertas reales y un presupuesto que funciona no cuestan nada. Los planes de pago suben los límites y revisan más seguido: esa es toda la diferencia.",
    freeNote: "Sin tarjeta, sin prueba, sin caducidad.",
    language: "Idioma",
  },

  auth: {
    tagline: "Sweep — tu compañero de compras online",
    email: "Correo",
    password: "Contraseña",
    signUp: "Crear cuenta",
    logIn: "Entrar",
    forgot: "¿Olvidaste tu contraseña?",
    continueAsGuest: "Continuar como invitado",
    checkEmail: "Revisa tu correo para confirmar la cuenta y luego entra.",
    badCredentials:
      "El correo o la contraseña no son correctos. Prueba «¿Olvidaste tu contraseña?» abajo.",
    notConfirmed: "Confirma tu correo primero — busca el enlace en tu bandeja.",
    needBoth: "Escribe un correo y una contraseña.",
  },

  reset: {
    title: "Cambiar tu contraseña",
    checkTitle: "Revisa tu correo",
    intro: "Te enviaremos un código. Es válido durante una hora.",
    sent: "Si existe una cuenta para {{email}}, el código va en camino. Escríbelo abajo con tu nueva contraseña.",
    codePlaceholder: "Código del correo",
    newPassword: "Nueva contraseña (8+ caracteres)",
    sendCode: "Enviar código",
    changePassword: "Cambiar contraseña",
    sendAnother: "Enviar otro código",
    enterEmail: "Escribe el correo con el que te registraste.",
    enterCode: "Escribe el código completo del correo.",
    tooShort: "La contraseña necesita al menos 8 caracteres.",
    badCode: "Ese código no funcionó. Puede haber caducado — pide uno nuevo.",
    done: "Contraseña cambiada. Ya entraste.",
  },

  home: {
    yourPlan: "TU PLAN",
    notConfirmed: "Sin confirmar",
    seeUpgrades: "Ver planes",
    shortcuts: "Accesos",
    budget: "Presupuesto",
    budgetHint: "Controla tus gastos",
    radar: "Radar de Ofertas",
    radarHint: "Vigila un precio",
    lists: "Listas",
    listsHint: "Regalos y deseos",
    leaderboard: "Clasificación",
    createAccount: "Crear una cuenta",
    alertsOff: "Las alertas de precio están apagadas",
    alertsOffBody: "No te enterarás de una bajada mientras siga activa.",
    storeDownOne: "{{store}} no está disponible",
    storeDownMany: "{{count}} tiendas no están disponibles",
    storeDisabled:
      "Ahora mismo no podemos conectar con {{stores}} desde nuestros servidores. Estamos en ello — todo lo demás busca con normalidad.",
    storeFailing:
      "{{stores}} está teniendo problemas. Suele ser temporal y se arregla solo; las demás tiendas no se ven afectadas.",
  },

  search: {
    placeholder: "Busca en todas las tiendas a la vez…",
    button: "Buscar",
    topPicks: "Destacados",
    byStore: "Por tienda",
    compare: "Comparar",
    added: "Añadido",
    list: "Lista",
    open: "Abrir",
    sweep: "Analizar",
    bought: "Comprado",
    edit: "Editar",
    resultsPerStore: "Resultados por tienda",
    resultsHelp: "Cuántos artículos devuelve cada tienda. Menos llega más rápido.",
    fastest: "más rápido",
    thorough: "más completo",
    skipped: "Omitimos {{stores}} — no venden este tipo de cosas.",
    amazonPending: "Amazon sigue cargando — puede tardar hasta 3 minutos.",
    watchAd: "Ver anuncio por +1",
  },

  radar: {
    searchLabel: "Buscar",
    searchMeans: "miras una vez, ahora mismo",
    radarLabel: "Radar",
    radarMeans: "Sweep sigue mirando, durante semanas",
    autoChecks:
      "Sweep los repite por su cuenta, hasta cada {{hours}} horas, y te avisa cuando algo mejora el mejor precio encontrado.",
    manualChecks:
      "En tu plan los radares se ejecutan cuando pulsas Actualizar — {{count}} veces al día. Pro y Ultimate los repiten en segundo plano y te avisan.",
    whatFor: "¿Qué estás buscando?",
    targetPrice: "Precio objetivo (opcional)",
    watch: "Vigilar",
    refresh: "Actualizar",
    checking: "Revisando todas las tiendas…",
    noneLeft: "No te quedan actualizaciones hoy",
    left: "Quedan {{count}}",
    empty: "No hay nada en el radar",
    emptyBody:
      "Añade algo arriba — «airpods pro» por menos de $180, por ejemplo — y Sweep lo buscará en todas las tiendas.",
    under: "por menos de {{price}}",
    anyPrice: "cualquier precio interesante",
    bestSeen: "Mejor visto: {{price}}",
    noMatch: "Ahora mismo no hay nada bajo tu objetivo.",
    stopWatching: "¿Dejar de vigilar esto?",
    stopBody: "Sweep dejará de buscarlo.",
  },

  tracking: {
    empty: "Todavía no sigues nada",
    sameAsStart: "Igual que cuando empezaste ({{price}})",
    downSince: "Ha bajado {{amount}} desde que empezaste",
    upSince: "Ha subido {{amount}} desde que empezaste",
    limitReached: "Límite alcanzado",
    tracked: "{{used}} de {{limit}} en seguimiento",
    stopTracking: "Dejar de seguir",
    keepTracking: "Seguir vigilando",
    loggedIt: "Añadido a tu presupuesto",
    stopToo: "¿Quieres dejar de vigilar su precio también?",
  },

  budget: {
    spentThisMonth: "GASTADO ESTE MES",
    setBudget: "Fijar un presupuesto mensual",
    leftOf: "Te quedan {{amount}} de {{budget}}",
    overBudget: "{{amount}} por encima de tu presupuesto de {{budget}}",
    whereItWent: "En qué se fue",
    logPurchase: "Anotar una compra",
    logThis: "Anotar esta compra",
    editPurchase: "Editar compra",
    amount: "Importe",
    category: "Categoría",
    note: "Nota (opcional)",
    whatWasIt: "¿Qué era?",
    logIt: "Anotar",
    newCategory: "Nueva",
    categoryName: "Nombre de la categoría…",
    nothingLogged: "Todavía no has anotado nada",
    nothingBody:
      "Anota lo que gastas y se irá sumando aquí. ¿Compraste algo que seguías? Tiene un botón para eso.",
    hint: "Toca una entrada para editarla, mantén pulsado para borrarla.",
    deleteTitle: "¿Eliminar esta compra?",
    perCategoryPro: "Pon un límite por categoría con Pro",
  },

  lists: {
    title: "Listas",
    newList: "Nombre de la lista…",
    create: "Crear",
    addToList: "Añadir a una lista",
    alreadyOn: "Ya está en esta lista",
    full: "Llena ({{limit}} artículos)",
    items: "{{count}} artículos",
    noLists:
      "Todavía no tienes listas. Ponle nombre a una abajo y este producto entra directo.",
    empty: "Esta lista está vacía. Pega el enlace de un producto abajo.",
    share: "Compartir",
    unshare: "Dejar de compartir",
    openItem: "Abrir",
  },

  sweep: {
    title: "ANALIZAR OFERTA",
    checking: "Revisando el resto de tiendas y el historial de precios…",
    takesSeconds: "Esto tarda unos segundos.",
    remaining: "Quedan {{count}} hoy",
    storeClaims: "LA TIENDA DICE",
    actually: "EN REALIDAD",
    percentOff: "{{percent}}% de descuento",
    normalPrice: "es su precio normal",
    belowUsual: "{{percent}}% por debajo de lo habitual",
    cheaperElsewhere: "Más barato en otra tienda",
    worthALook: "Merece un vistazo",
    worthALookBody:
      "Cuestan menos pero no estamos seguros de que sean idénticos — revisa los detalles antes de comprar.",
    nothingCheaper: "No encontramos nada más barato en otra tienda.",
    priceHistory: "Su historial de precios",
    now: "Ahora",
    lowest: "Mínimo",
    typical: "Habitual",
    checks: "Revisiones",
    save: "ahorras {{amount}}",
    unreachable:
      "No pudimos conectar con {{stores}} esta vez — puede que allí haya opciones más baratas.",
  },

  profile: {
    account: "Cuenta",
    plan: "Plan",
    comparePlans: "Comparar planes",
    seeIncluded: "Ver qué incluye",
    planUnknown: "No podemos conectar con Sweep, así que tu plan no está confirmado.",
    appearance: "Apariencia",
    appearanceHint: "«Sistema» sigue a tu teléfono, así que cambia cuando él cambia.",
    system: "Sistema",
    light: "Claro",
    dark: "Oscuro",
    language: "Idioma",
    languageHint: "Cambia todo lo que lees en Sweep.",
    priceAlerts: "Alertas de precio",
    enableAlerts: "Activar alertas de precio",
    storeStatus: "Estado de las tiendas",
    storeStatusHint: "De qué tiendas puede leer precios Sweep ahora mismo.",
    working: "Funciona",
    unavailable: "No disponible",
    help: "Ayuda",
    emailSupport: "Escribir a soporte",
    privacy: "Política de privacidad",
    privacyHint: "Qué guarda Sweep, y por qué",
    replayTour: "Ver el tour otra vez",
    replayHint: "Repasa cómo funciona Sweep",
    version: "Versión",
    signOut: "Cerrar sesión",
    deleteAccount: "Eliminar mi cuenta",
    deleteTitle: "¿Eliminar tu cuenta?",
    deleteBody:
      "Esto borra tus productos seguidos, listas, presupuesto, radares y XP. No se puede deshacer.",
    deleteConfirm: "Eliminar para siempre",
    deleteKeep: "Conservar mi cuenta",
    yourPassword: "Tu contraseña",
    enterPassword: "Escribe tu contraseña para confirmar.",
    thisAccount: "Esta cuenta",
    changeUsername: "Cambiar",
  },

  offline: {
    banner:
      "Sin conexión — Sweep necesita internet para los precios, y lo que ves puede estar desactualizado.",
  },

  error: {
    title: "Algo no salió bien",
    body: "Sweep encontró un error. Tus productos seguidos, listas y presupuesto están guardados en nuestros servidores, así que no se ha perdido nada.",
    tellUs: "Cuéntanos qué pasó",
  },
};

export const translations = { en, es };
export type Language = keyof typeof translations;
