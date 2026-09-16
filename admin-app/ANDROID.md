# Android APK build

The project has reproducible commands for generating an Android APK:

```sh
cd admin-app
npm install
npm run android:init
npm run android:apk
```

The release APK is emitted by the Android Gradle project created under
`src-tauri/gen/android/`. Use `npm run android:aab` when preparing a Google
Play upload instead. Do not commit signing keys or an Android keystore; keep
them outside this repository and configure signing in Android Studio/Gradle.

## Required local tools

Install Android Studio, then use its SDK Manager to install Android SDK
Platform, Platform-Tools, Build-Tools, and NDK (Side by side). Set
`ANDROID_HOME` to the SDK directory and `JAVA_HOME` to Android Studio's JBR.
Then run `npm run android:init` again if the first initialization was performed
before the SDK was available. Tauri's current Android prerequisites are the
reference for exact platform versions.

## Important: mobile sync is a separate feature

The laptop studio edits a local Git checkout and runs Git/npm locally. Android
cannot safely reuse those machine-local commands. A phone editor needs a
remote, authenticated sync layer (for example GitHub OAuth/GitHub App with a
small backend) that reads/writes the same repository and creates commits.

The APK build commands above package the client. Before enabling remote edits,
choose the authentication and hosting model; never embed a GitHub personal
access token, a deploy hook secret, or a signing key in the APK.
