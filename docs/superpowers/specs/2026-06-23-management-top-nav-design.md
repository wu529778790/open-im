# Management Top Navigation Redesign

## Goal

Rework the management page header into a mixed navigation-and-actions layout that behaves like a real admin shell instead of a thin utility bar. The redesign should improve hierarchy, make section switching explicit, and keep high-frequency actions visible without overloading one row.

## Current Problems

- The current top bar is implemented as a narrow action strip, not a navigation surface.
- Primary sections exist conceptually (`overview`, `platforms`, `files`, `ai`, `wizard`) but are not exposed as first-class navigation in the dashboard shell.
- The codebase already has a `Sidebar` nav model, but `Dashboard` does not use it, so the UI has split intentions: latent navigation structure plus an overworked header.
- Service status, global tools, and page actions currently compete for the same visual layer.

## Chosen Direction

Use a two-tier mixed header:

1. Global top bar for brand, primary navigation, service status, and global utilities.
2. Context toolbar for current section title, helper text, and section-specific actions.

This keeps navigation and actions in the same header area, but separates their roles clearly.

## Information Architecture

### Primary Navigation

Expose these top-level sections in the header:

- Overview
- Platforms
- Config Files
- AI

Do not expose `Setup Wizard` as a normal top-level tab in the main management shell. The wizard remains a first-run or explicit setup flow, not a peer destination once the dashboard is active.

### Section Ownership

- `Overview`: summary stats only
- `Platforms`: platform cards and platform test results
- `Config Files`: config JSON and settings editors
- `AI`: AI tool configuration section

## Layout

### Tier 1: Global Header

Left to right:

- Brand mark and `open-im`
- Primary navigation tabs
- Service status pill
- Global tools: GitHub link, dark mode toggle

Behavior:

- The active tab is visually prominent and stable.
- Service status remains visible across all sections.
- Global tools remain in the far right cluster.

### Tier 2: Context Toolbar

Left to right:

- Current section title
- Current section helper text
- Section actions aligned right

Actions by section:

- `Overview`: no destructive or save actions, optionally empty
- `Platforms`: validate, save, start/stop
- `Config Files`: save, format/reset remain inside cards; top toolbar keeps validate, save, start/stop
- `AI`: validate, save, start/stop

The toolbar is not a second navigation row. It is contextual control for the active destination.

## Interaction Model

- Switching tabs updates local dashboard state only. No route system is introduced in this change.
- The dashboard renders one active section at a time rather than stacking all sections vertically.
- Existing action handlers remain the source of truth:
  - validate
  - save
  - start
  - stop
- Existing wizard behavior remains intact. If the dashboard is in first-run wizard mode, the wizard still takes over the main surface.

## Responsive Behavior

Desktop:

- Two visible header tiers
- Primary nav stays inline
- Context title and actions share one row

Tablet and mobile:

- Tier 1 may wrap or horizontally compress navigation without truncating labels into unreadable chips
- Tier 2 stacks title/meta above actions when space is limited
- Keep service status visible
- Keep start/stop reachable without opening an extra menu

No sidebar is introduced in this phase. The redesign stays header-first on all breakpoints.

## Visual Rules

- Match the existing dashboard visual language: restrained surfaces, 1px borders, low-radius controls, compact admin density.
- Avoid decorative cards or hero treatment in the header.
- Navigation tabs should read as real location controls, not generic buttons.
- Service status should become a contained badge or pill, stronger than muted text but quieter than primary actions.
- Global tools should be visually subordinate to page actions.

## Accessibility

- Tabs must be keyboard reachable and expose active state clearly.
- The current section should be perceivable without relying on color alone.
- Button labels stay explicit.
- The status indicator keeps readable text, not dot-only state.

## Component and File Plan

### Modify

- `web/src/Dashboard.tsx`
  - introduce active section state
  - render the active section instead of the current stacked layout
  - pass section metadata and actions into the header

- `web/src/components/Header.tsx`
  - replace the single utility row with the two-tier mixed header
  - render primary nav and contextual action area

- `web/src/styles/global.css`
  - add styles for header tiers, nav tabs, status pill, context toolbar, and responsive behavior

### Reuse

- `web/src/components/Sidebar.tsx`
  - reuse its nav item model or extract the shared nav definition

- `web/src/components/OverviewStats.tsx`
- `web/src/components/PlatformCard.tsx`
- `web/src/components/ConfigFilesSection.tsx`
- `web/src/components/AiConfigSection.tsx`

The redesign should prefer reusing existing section components instead of rewriting section internals.

## Non-Goals

- No backend API changes
- No routing library
- No setup wizard redesign
- No platform form restructuring beyond what is needed for section rendering
- No sidebar rollout in this task

## Testing

- TypeScript build passes
- Header renders correctly in light and dark mode
- Tab switching shows the intended section and hides the others
- Existing actions still work from the new toolbar
- Wizard takeover still works when no platform is enabled
- Mobile layout keeps nav, status, and actions usable

## Risks and Mitigations

- Risk: local state navigation can drift from future routing work
  - Mitigation: keep nav ids simple and isolated in one shared definition

- Risk: action semantics become inconsistent across sections
  - Mitigation: define one toolbar contract in `Dashboard` and keep handlers centralized

- Risk: header becomes crowded on smaller screens
  - Mitigation: split concerns across two tiers and allow the second tier to stack
