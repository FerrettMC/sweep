# Getting back into the Claude Code session

## The short version

```bash
cd /home/ferret/Sweep
claude --continue
```

`--continue` (short: `-c`) reopens the most recent session for this directory.
`--resume` (short: `-r`) shows a picker instead, if you want an older one.

**The directory matters.** Sessions are keyed to the folder they were started
in. Running `claude -c` from your home folder or from `sweep-app/` will not find
this conversation — it has to be `/home/ferret/Sweep`.

## Where it actually lives

```
~/.claude/projects/-home-ferret-Sweep/989adf7e-7a8f-4e3d-ad87-8b501279a68d.jsonl
```

That is this session. It is written continuously while you work, not saved on
exit, so closing VS Code or losing power does not lose the conversation.

To reopen this exact one rather than whatever was most recent:

```bash
claude --resume 989adf7e-7a8f-4e3d-ad87-8b501279a68d
```

The VS Code extension also lists recent sessions. If this one isn't showing
there, the commands above still work.

## Your code is separate from the chat

The chat and the working tree are independent. Closing the editor never touches
your files. But an uncommitted working tree is the thing actually worth
protecting — commit before stepping away from anything you'd hate to redo.

---

# Where we left off (15 Aug 2026)

Everything below is committed. Both projects typecheck clean.

## Ready to publish

The code is done. Remaining work is Play Console, not the repo.

Pre-flight already verified:

- EAS account `benju-studioss-team`, matching `app.json` owner
- `app.json`, `eas.json` and `google-services.json` all tracked by git — EAS
  builds from the git archive, so an untracked file is a file the build never
  sees
- Production profile carries `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`
  and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `versionCode` is remote with auto-increment, so it cannot collide

Build:

```bash
cd sweep-app
npx eas-cli build --profile production --platform android
```

First run asks to generate an Android keystore — say yes and let EAS keep it.
Losing it means never being able to update the app under this package name.

## Pricing decisions (15 Aug 2026)

- **7-day free trial** on both Pro and Ultimate. Chosen over 14 to limit
  exposure; the real cost of a trial user is Bright Data calls for Amazon, not
  the sticker price, so extending later is cheap if conversion disappoints.
  Trial length is a Play base-plan setting and can change without an app update.
- **No custom refund policy.** Google self-serves refunds for 48 hours; past
  that they arrive in Play Console for a case-by-case decision. A free trial is
  the better answer to refund pressure anyway.
- **Upgrades Pro to Ultimate use default time proration.** Play credits unused
  Pro time automatically, so "upgrading is cheaper" needs no discount logic. No
  promotional upgrade pricing at launch — discounting to existing subscribers
  teaches people to wait for discounts before there is any conversion data.

Subscription products get created in Play Console *after* the first upload, then
the billing flow goes in.

## Deliberately deferred

- **Google Sign-In.** Code is roughly 50 lines; the credentials are the work.
  The trap: Play App Signing re-signs the AAB, so Google sees a different SHA-1
  than the upload key, and sign-in fails with `DEVELOPER_ERROR` for everyone who
  installs from the Store. That fingerprint only exists after the first Play
  Console upload — so wire the credentials then, not before. There are currently
  no OAuth clients in `google-services.json` at all.
- **Ads are declared as "No" in Play Console.** True today: `ADS_ENABLED` in
  `lib/ads.ts` is false and no ad SDK is in the build. When ads are restored,
  update that declaration in the *same* release — shipping ads under a "no ads"
  declaration is a policy violation, and declaring ads early puts a "Contains
  ads" badge on the listing that costs installs for nothing.
- **Play reviewer account**: `play-review@sweepshopping.com`, Pro tier. Play
  reuses these credentials on every future update review, so don't delete it or
  change the password without updating Play Console.
- **Spanish for backend error messages.** ~84 strings in
  `sweep-backend/src/routes/`. The whole app is translated; these only surface
  on failures. Keys live in `sweep-backend/src/lib/i18n.ts` already, and
  `plans.ts` shows the pattern.
- **`google-services.json` has a stale `com.anonymous.sweep` entry** from before
  the package rename. Harmless; regenerate next time you are in Firebase.

## Things worth remembering

- **The rating prompt fires once per install**, a day after first launch, when
  someone tracks a product. Rules are a pure function in `lib/reviewGate.ts`
  with a test (`npm run test:review`) — Play's review API gives no callback and
  silently shows nothing once its quota is spent, so nothing can branch on
  whether it worked.
- **Retailer cooldown**: one blocked response pauses that retailer app-wide for
  2 minutes, doubling to 30 on repeats. In-memory per process, so a second
  server instance would halve the effective pause. `npm run test:cooldown`.
- **Server-translated copy needs stable ids.** Plan upgrades carry `id`
  alongside the translated `label`; filtering on `label` breaks the moment
  someone switches language. Bit us once already.
- **Template-literal strings hide from translation sweeps.** Three were missed
  that way — the store-down banner, a tracking-limit message, a shortcut hint.
- Tests still run against the **production** Supabase project. The
  `EXPO_PUBLIC_SUPABASE_*` env split is what makes a scratch project possible.

## Next up

Play Console: $25 account, Data Safety form, content rating questionnaire,
store listing (7 images ready), then upload the AAB. After that: subscription
products, Google Sign-In credentials, then ads and crash reporting.
