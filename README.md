# Velocity

Velocity is a daily execution app. The day is three marks: wake up inside a window, train, and finish a deep-work block. A streak is counted from those logs. The same Next.js app runs in the browser and inside the iPhone app.

Repository: [github.com/hs115488/velocity-app](https://github.com/hs115488/velocity-app)

## Free and Pro

Wake, train, and deep work stay free. The streak stays in front of the paywall.

| | Free | Pro |
| --- | --- | --- |
| Three daily marks | Yes | Yes |
| Timed tasks | The first one | The full list, including carry-over |
| Coach | Baseline | The rest of the patterns |
| Reminders and Focus | | Wake alarm, lights-out, and Focus |

Pro is a subscription:

| Product id | Price | Trial |
| --- | --- | --- |
| `velocity.pro.yearly` | $39.99 / year | 7 days |
| `velocity.pro.monthly` | $6.99 / month | None |

On iPhone, StoreKit charges the Apple ID. In the browser there is no App Store, so the same plans are saved on that device and the screen says so. Cancel an iPhone renewal in Settings → your name → Subscriptions.

Create both products in App Store Connect before a customer can pay. The local catalog used by the Xcode simulator is `ios/App/App/Products.storekit`.

## The day

Defaults are a 5:30 AM wake, 15 minutes of grace, and 90 minutes of deep work. The wake window opens 90 minutes early and never before 4:00 AM, unless the target itself is earlier. A late wake is logged and does not count.

The standard (wake time, grace, deep-work minutes) locks once the day is touched. A change waits until tomorrow.

Onboarding runs until `profile.onboarded` is set. The first day uses the standard chosen there.

## Data

Everything lives on the device under the key `velocity:v1`. The iPhone app stores it with Capacitor Preferences. The browser uses local storage. There is no account and no server.

A damaged day is dropped on load. One bad log does not wipe the rest of the save.

## Project layout

Domain logic is pure and tested. The screens call it.

| Path | Role |
| --- | --- |
| `lib/velocity.ts` | Dates, wake window, streak, grade |
| `lib/tasks.ts` | Timed tasks and carry-over |
| `lib/billing.ts` | Plans, trial, who can start a task |
| `lib/store.ts` | StoreKit purchase, restore, and sync |
| `lib/coach.ts` | What the coach says about the day |
| `lib/storage.ts` | Load and save `velocity:v1` |
| `hooks/use-velocity.ts` | React state |
| `app/` | Home, settings, Pro, privacy, terms |
| `ios/` | Capacitor iOS project |

Bundle id: `com.hareshsingh.velocity`. Support: haresh.singh.97@gmail.com.

## Run it

Node 22 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The production build is a static export in `out/`:

```bash
npm run build
```

Tests use the New York calendar so date logic stays stable:

```bash
npm test
```

## iPhone

The app is a static site inside Capacitor. `npm run ios:sync` builds the site and copies it into `ios/`.

```bash
npm run ios:sync
npm run ios:open
```

Run from Xcode with the App scheme. The scheme points at `Products.storekit`, so the simulator can buy Pro without App Store Connect. A browser session and a simulator session do not share data.

Shipping to the App Store still needs an Apple Development certificate, the two subscriptions in App Store Connect, and a purchase plus restore checked on a real iPhone.
