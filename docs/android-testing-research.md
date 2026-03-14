# Android Testing Research for Bull 'Em

Research into testing strategies for the Bull 'Em Android app (Capacitor WebView shell).

## Current State

- **App architecture:** Capacitor 8 native shell loading `https://bullem.cards` in a WebView
- **Android target:** minSdk 24 (Android 7.0), targetSdk 36 (Android 16)
- **Native code:** Minimal — only `MainActivity.java` extending `BridgeActivity`
- **Existing tests:** Placeholder JUnit/Espresso scaffolding only
- **CI:** No Android CI (GitHub Actions budget constrained)

## Testing Layers

### 1. Web Layer Testing (Already Covered)

The React app is tested via Vitest (unit/integration). This covers game logic, UI components, and socket interactions. Since the native app loads the same web app from production, **web tests already cover ~95% of the app's functionality.**

### 2. Native Shell Testing (New)

What's unique to the Android native context:

| Area | Risk Level | Notes |
|------|-----------|-------|
| WebView rendering | Medium | Could differ from Chrome on same device |
| Safe area / notch handling | Medium | `useViewportHeight` hook manages this |
| Deep links / URL schemes | Low | Not implemented yet |
| Push notifications (FCM) | Medium | Requires `google-services.json` |
| Haptics (Capacitor plugin) | Low | Non-critical feature |
| App lifecycle (pause/resume) | Medium | WebSocket reconnection on app resume |
| Back button behavior | Medium | Android hardware back button in WebView |
| Splash screen | Low | `core-splashscreen` library handles it |
| Orientation changes | Medium | Landscape/portrait transitions |

### 3. Testing Approaches Evaluated

#### A. Espresso (Android UI Testing) — Not Recommended

**Why not:** Espresso is designed for native Android UI elements. Bull 'Em's UI is entirely web-based inside a WebView. Espresso can interact with WebViews via `Espresso.onWebView()`, but:
- Limited to basic DOM interactions (click, type)
- No access to React state or component tree
- Fragile selectors (CSS/XPath on rendered HTML)
- Poor debugging experience for web content

**Verdict:** Overkill for our thin native shell. The web app is better tested with web tools.

#### B. UI Automator — Partially Useful

**What it's good for:** System-level interactions (notifications, app switching, back button).

**Use cases for Bull 'Em:**
- Verify app launches and loads WebView
- Test Android back button behavior
- Test app pause/resume (WebSocket reconnection)
- Test notification tap → app opens correct screen

**Verdict:** Worth using for the few native-specific behaviors.

#### C. Appium — Recommended for E2E

**Why:** Cross-platform (same tests for iOS and Android), supports WebView context switching, works with any web testing approach inside the WebView.

**Architecture:**
```
Appium Server
  ├── UiAutomator2 driver (Android)
  └── XCUITest driver (iOS)
       └── Context switch: NATIVE_APP ↔ WEBVIEW_cards.bullem.app
            └── Inside WebView: standard Selenium/WebDriver commands
```

**Key capability:** Can switch between native context (for back button, notifications) and WebView context (for interacting with the React app). This is exactly what Bull 'Em needs.

**Test example flow:**
1. Launch app (native context)
2. Wait for WebView to load
3. Switch to WebView context
4. Interact with React app (create room, join game)
5. Switch to native context
6. Press Android back button
7. Verify app handles it correctly (no accidental navigation)

**Verdict:** Best fit for comprehensive E2E testing of the Capacitor app.

#### D. Detox (Wix) — Not Recommended

**Why not:** Designed for React Native, not Capacitor/WebView apps. Poor WebView support.

#### E. Playwright/Puppeteer with Android Chrome — Alternative

**What it is:** Connect Playwright to Chrome on an Android device/emulator via Chrome DevTools Protocol.

**Pros:** Same testing framework as web, familiar API, fast execution.

**Cons:** Tests Chrome, not the actual Capacitor WebView. Misses native shell behaviors (back button, lifecycle, notifications).

**Verdict:** Good for quick smoke tests, but doesn't cover native integration points.

### 4. Recommended Strategy

Given that Bull 'Em is a WebView app with minimal native code:

#### Tier 1: Web Tests (Existing — Vitest)
- **Scope:** Game logic, React components, socket handlers
- **Coverage:** ~95% of user-facing functionality
- **Already in place** — no changes needed

#### Tier 2: Capacitor-Specific Integration Tests (New — Manual Checklist)
- **Scope:** WebSocket reconnection on app resume, viewport/safe area on real devices, orientation changes, back button behavior
- **Approach:** Manual testing checklist for pre-release validation
- **Why manual:** Low volume of native-specific behaviors, CI budget constraints, Capacitor's thin abstraction layer reduces risk

#### Tier 3: Automated Native E2E (Future — Appium)
- **Scope:** Full user journeys through native app (launch → lobby → game → results)
- **Trigger to implement:** When Play Store releases become regular (weekly+) or when native features expand beyond WebView shell
- **Setup:** Appium + WebDriverIO, running against Android emulator
- **Run locally** (not in CI) due to GitHub Actions budget constraints

### 5. Manual Testing Checklist (Immediate Value)

Pre-release Android checklist to validate before each Play Store submission:

```
[ ] App launches and displays splash screen
[ ] WebView loads bullem.cards within 5 seconds on WiFi
[ ] Login/auth flow works (if applicable)
[ ] Create room → get room code → share via Android share sheet
[ ] Join room via room code
[ ] Play full game round (deal → call → bull/true → resolution)
[ ] Sound plays on game events (with device volume up)
[ ] Haptic feedback fires on bull/true calls
[ ] Rotate device — UI adapts correctly, no content cut off
[ ] Press Android back button during game — confirm dialog or no-op (don't exit)
[ ] Switch to another app and back — WebSocket reconnects, game state preserved
[ ] Receive push notification (if FCM configured) — tap opens correct screen
[ ] App works on Android 7 device/emulator (minSdk boundary)
[ ] App works on latest Android version
[ ] No horizontal scroll on small screens (320px width)
[ ] Touch targets are large enough (44px+) for comfortable play
```

### 6. Appium Setup Guide (When Ready)

When the team decides to automate Tier 3:

```bash
# Install Appium
npm install -g appium
appium driver install uiautomator2

# Install WebDriverIO (test runner)
npm install --save-dev @wdio/cli @wdio/appium-service @wdio/mocha-framework

# wdio.conf.ts (key config)
capabilities: [{
  platformName: 'Android',
  'appium:deviceName': 'emulator-5554',
  'appium:app': './client/android/app/build/outputs/apk/debug/app-debug.apk',
  'appium:automationName': 'UiAutomator2',
  'appium:autoWebview': true,  // auto-switch to WebView context
}]
```

**Key Appium commands for Bull 'Em:**
```typescript
// Switch contexts
const contexts = await driver.getContexts();
await driver.switchContext('WEBVIEW_cards.bullem.app');

// Inside WebView — standard web selectors
await $('[data-testid="create-room"]').click();
await $('[data-testid="room-code"]').waitForDisplayed();

// Switch back to native for back button
await driver.switchContext('NATIVE_APP');
await driver.pressKeyCode(4); // Android BACK
```

### 7. Android SDK Setup Notes

For local development/testing, Android Studio needs:

1. **SDK Location:** Set in Android Studio → Settings → Languages & Frameworks → Android SDK
   - Windows: `C:\Users\<user>\AppData\Local\Android\Sdk`
   - macOS: `~/Library/Android/sdk`
   - Linux: `~/Android/Sdk`

2. **Required SDK components:**
   - Android SDK Platform 36 (targetSdk)
   - Android SDK Platform 24 (minSdk — for emulator testing)
   - Android SDK Build-Tools (latest)
   - Android SDK Platform-Tools
   - Android Emulator
   - System image for emulator (e.g., "Google APIs Intel x86_64")

3. **Build the debug APK:**
   ```bash
   cd client/android
   ./gradlew assembleDebug
   # Output: app/build/outputs/apk/debug/app-debug.apk
   ```

4. **Run on connected device/emulator:**
   ```bash
   npx cap run android
   ```

### 8. CI Considerations

Per project constraints, **no new GitHub Actions workflows**. Options for future Android CI:

| Service | Free Tier | Android Support | Notes |
|---------|-----------|----------------|-------|
| Codemagic | 500 min/month | Native | Already used for iOS builds |
| Bitrise | 300 min/month | Native | Popular for mobile CI |
| GitHub Actions | Limited | Via emulator action | Budget constrained — avoid |
| Local only | Free | Full | Current recommendation |

**Recommendation:** Extend the existing Codemagic setup (already used for iOS) to also build and test Android. This avoids adding GitHub Actions workflows.

## Summary

For a Capacitor WebView app with minimal native code, the testing pyramid is inverted compared to native apps:

```
        ┌──────────┐
        │ Native   │  ← Small: back button, lifecycle, notifications
        │ E2E      │     (manual checklist now, Appium later)
        ├──────────┤
        │ Web E2E  │  ← Medium: full user journeys in browser
        │          │     (Playwright when needed)
        ├──────────┤
        │ Web Unit │  ← Large: game logic, components, sockets
        │ & Integ  │     (Vitest — already comprehensive)
        └──────────┘
```

The web test suite is the primary quality gate. Native testing adds value only for the thin shell behaviors that differ between browser and WebView. Start with the manual checklist, automate with Appium when release cadence demands it.
