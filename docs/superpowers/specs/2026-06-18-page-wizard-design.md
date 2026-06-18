# Page Wizard Design

## Goal
Replace CLI `init` with a page-based setup wizard that guides users through configuring Claude API + all platforms.

## Trigger
- Auto: when no platform is enabled, wizard opens automatically
- Manual: "Setup Wizard" button in dashboard sidebar

## Flow
Single page with all platforms displayed in parallel grid:
1. **Claude API section** (top) — API Key / Auth Token / Third-party / Skip
2. **Platform grid** — each card shows fields, test button, QR login (if applicable)
3. **Save + Start button** (bottom) — saves all config and starts bridge

## UX Details
- Platform cards: disabled by default, click to expand and configure
- QR login: inline in ClawBot card, click "Scan QR" shows QR code
- Progress: green dot = configured, gray = not configured
- Validation: required fields checked before save
- Completion: auto-save + auto-start + redirect to dashboard

## Components
- `SetupWizard.tsx` — main wizard component (rewrite existing)
- `PlatformWizardCard.tsx` — per-platform config card with QR support
- `ClaudeApiSection.tsx` — Claude API config section

## Files to modify
- `web/src/components/SetupWizard.tsx` — complete rewrite
- `web/src/components/PlatformCard.tsx` — add QR inline display
- `web/src/Dashboard.tsx` — auto-trigger wizard on first run
- `web/src/styles/global.css` — wizard styles
- `src/config-web-page-i18n.ts` — new i18n keys
