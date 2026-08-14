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

# Where we left off (14 Aug 2026)

## In flight: multi-language support (English + Spanish)

Done:

- `sweep-app/lib/i18n/translations.ts` — 222 keys x 2 languages
- `sweep-app/lib/i18n/index.ts` — observable language store, same pattern as the
  theme store, so switching language re-renders the whole tree at once
- `sweep-backend/src/lib/i18n.ts` — 113 keys x 2, plus `localeFrom()` for
  parsing `Accept-Language`
- `sweep-backend/src/test-i18n.ts` — parity test, `npm run test:i18n`, 18/18
- Language pickers wired into Profile and Onboarding
- `Accept-Language` sent from `lib/api.ts`; `loadLanguage()` runs at startup

Still to do:

1. **Backend locale threading** — `plans.ts` should take a `Locale` and run its
   generated feature lines, dial labels, names, taglines and badges through
   `t()`. Then thread `localeFrom(request.headers["accept-language"])` into the
   routes that return user-facing errors.
2. **App screens** — roughly 300 hardcoded strings across ~32 screens still need
   converting to `useTranslate()`.

The backend half is self-contained and has a test, so it's the easier one to
pick up cold.

## Also changed today, uncommitted

- **Keyboard handling.** Buttons were being pushed under the open keyboard, or
  having their first tap eaten by a `ScrollView`. Fixed in `auth`, `budget`,
  `lists`, `AddToListSheet`, `TrackedItemSheet`, `UsernameSheet`. The rule: any
  `ScrollView` containing a `TextInput` needs
  `keyboardShouldPersistTaps="handled"`, or the keyboard spends the first tap
  dismissing itself instead of pressing the button.
- **Signup with an existing email.** Supabase deliberately returns a
  success-shaped response for a duplicate so nobody can probe which addresses
  have accounts; the only tell is an empty `identities` array. We now detect it
  and sign the person straight in with the credentials they already typed
  instead of telling them to press a different button. Both handlers also got
  `try/finally` — a throw used to leave every button on the screen permanently
  disabled.
- **Supabase config moved to env** (`EXPO_PUBLIC_SUPABASE_URL` /
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`), mirrored into all three `eas.json` profiles
  and `.env`, with the previous literals kept as a fallback so a missing
  variable can't ship an app nobody can sign into.

## Two things to remember

- The **test account's password was reset** to a temporary value during
  debugging. Change it via _Forgot your password?_ — it is not written down in
  this repo on purpose.
- Tests still run against the **production** Supabase project. The env change
  above is what makes a separate scratch project possible; that's the fix.

## Next up after languages

Play Console ($25, Data Safety, content rating, listing copy), signed AAB via
`eas build --profile production`, `SMTP_FROM` in Railway, Cloudflare Email
Routing for `support@sweepshopping.com`, `npx expo install --fix`.
