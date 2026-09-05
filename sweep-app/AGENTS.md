# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Local release builds need Sentry switched off

`npx expo run:android --variant release` fails at
`:app:createBundleReleaseJsAndAssets_SentryUpload_*` with:

    error: An organization ID or slug is required (provide with --org)

`SENTRY_ORG` is set in `eas.json`, so EAS cloud builds have it and local ones
never do. Nothing is wrong with the build — sentry-cli just cannot upload
source maps without knowing the org. Skip the upload:

    env SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:android --variant release

`env` because the shell here is fish, where `VAR=value cmd` is a syntax error.

# android/ is gitignored

EAS runs `prebuild`, which regenerates the whole folder, so anything edited
there is thrown away on the next cloud build. Native config belongs in
`app.json` — the R8 rules live under `expo-build-properties` for exactly this
reason, after a release shipped with no minification because the config was
sitting in `android/` where EAS never saw it.
