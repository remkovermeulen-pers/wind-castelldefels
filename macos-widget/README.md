# Castelldefels Wind — macOS widget

A native macOS **Notification Centre widget** (Small + Medium) showing live wind
and kite-zone status for Castelldefels. It reads the app's existing Cloud
Functions — no backend of its own:

- `…/live` → current actual / average / gust / direction
- `…/zone` → latest twintip / surf / foil / open-closed status

| Size | Shows |
|---|---|
| Small | Average wind (kn), gust + direction, a coloured Twintip dot |
| Medium | Average wind, gust, direction · Twintip / Surf / Foil pills · zone open/closed |

Average ≥ 13 kn turns green (the app's alert threshold). Twintip/Surf/Foil use
green = SI!, orange = Quizás, red = No.

## Requirements

- **Xcode** (full app, not just Command Line Tools) — from the Mac App Store.
- A signing identity: a **free Apple ID** is enough to run it on your own Mac.

## Build & run

The `.xcodeproj` is already generated and committed, so you can open it directly:

```bash
open macos-widget/CastelldefelsWind.xcodeproj
```

Then in Xcode:

1. Select the **CastelldefelsWind** target → **Signing & Capabilities** → set
   **Team** to your Apple ID (add it in Xcode ▸ Settings ▸ Accounts if needed).
   Do the same for the **WindWidgetExtension** target. If Xcode complains the
   bundle id is taken, change the prefix `com.castelldefels.app` to something
   unique (e.g. add your initials) on both targets.
2. Pick the **CastelldefelsWind** scheme and press **Run** (⌘R). The little host
   app launches — that's expected; it exists only to register the widget.
3. Open **Notification Centre** (click the clock, or swipe left with two fingers
   from the right edge) → scroll down → **Edit Widgets** → find **Castelldefels
   Wind** → add the Small or Medium size.
4. You can quit the host app; the widget keeps updating on its own.

### Regenerating the project

The project is defined by `project.yml` (XcodeGen). If you change targets or
settings, regenerate with:

```bash
brew install xcodegen   # one-time
cd macos-widget && xcodegen generate
```

## How refresh works — read this

macOS widgets do **not** update in real time. WidgetKit refreshes them on a
system-managed budget — typically a handful of times per hour, more when you're
actively looking, throttled when you're not. The widget asks to be revisited
every ~20 minutes (`WindProvider`), but the OS has the final say. This is fine
for "should I head down to the beach?", but it is not the 15-second live feed
the open web app gives you.

Tapping the widget opens the full web app at
[wind-castelldefels.web.app](https://wind-castelldefels.web.app).

## Files

```
macos-widget/
  project.yml                 XcodeGen spec (source of truth)
  CastelldefelsWind.xcodeproj generated project (tracked, openable directly)
  App/                        tiny host app (registers the widget)
    CastelldefelsWindApp.swift
    ContentView.swift
    App.entitlements          app sandbox + outgoing network
  Widget/                     the widget extension
    WindWidgetBundle.swift    @main widget bundle
    WindWidget…               configuration
    WindProvider.swift        TimelineProvider (fetch + refresh cadence)
    WindWidgetViews.swift     Small + Medium SwiftUI layouts
    WindModel.swift           models + fetch from /live and /zone
    Info.plist                declares the widgetkit-extension point
    Widget.entitlements       app sandbox + outgoing network
```

The outgoing-network entitlement (`com.apple.security.network.client`) is
required — without it the sandboxed widget cannot reach the endpoints.
