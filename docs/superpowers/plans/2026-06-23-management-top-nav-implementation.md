# Management Top Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's thin utility header with a two-tier mixed navigation-and-actions header that supports section switching inside the management page.

**Architecture:** Keep the current single-page dashboard and add local section state in `Dashboard.tsx`. Rebuild `Header.tsx` into a two-tier shell that receives nav items, active section metadata, and existing action handlers from the dashboard. Reuse the existing section components and render one active section at a time.

**Tech Stack:** React, TypeScript, Vite, global CSS, existing dashboard components

## Global Constraints

- Rework the management page header into a mixed navigation-and-actions layout that behaves like a real admin shell instead of a thin utility bar.
- Use a two-tier mixed header.
- Expose these top-level sections in the header: Overview, Platforms, Config Files, AI.
- Do not expose `Setup Wizard` as a normal top-level tab in the main management shell.
- Switching tabs updates local dashboard state only. No route system is introduced in this change.
- The dashboard renders one active section at a time rather than stacking all sections vertically.
- Existing wizard behavior remains intact. If the dashboard is in first-run wizard mode, the wizard still takes over the main surface.
- No backend API changes.
- No routing library.
- No setup wizard redesign.
- No sidebar rollout in this task.

---

### Task 1: Define Shared Navigation Model And Header Contract

**Files:**
- Create: `web/src/components/dashboard-nav.ts`
- Modify: `web/src/components/Header.tsx`
- Modify: `web/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: existing i18n keys via `t(key: string): string`
- Produces: `DASHBOARD_NAV_ITEMS`, `type DashboardNavId`, and a widened `Header` prop contract used by `Dashboard.tsx`

- [ ] **Step 1: Create the shared nav definition file**

```ts
export const DASHBOARD_NAV_ITEMS = [
  { id: "overview", key: "dashboardTitle" },
  { id: "platforms", key: "platformsTitle" },
  { id: "files", key: "navConfigFiles" },
  { id: "ai", key: "aiTitle" },
] as const;

export type DashboardNavId = (typeof DASHBOARD_NAV_ITEMS)[number]["id"];
```

- [ ] **Step 2: Update `Sidebar.tsx` to import the shared ids instead of owning a separate list**

```ts
import { DASHBOARD_NAV_ITEMS } from "./dashboard-nav.js";
```

Expected result: `Sidebar` remains compilable, but no longer defines `wizard` as a normal dashboard destination.

- [ ] **Step 3: Expand `Header.tsx` props to support nav rendering and contextual metadata**

```ts
interface HeaderProps {
  activeNav: DashboardNavId;
  onNavigate: (id: DashboardNavId) => void;
  sectionTitle: string;
  sectionHint: string;
  showPrimaryActions: boolean;
  // existing action handlers stay unchanged
}
```

- [ ] **Step 4: Replace the current single-row header markup with two tiers**

```tsx
<header className="app-header">
  <div className="app-header-main">...</div>
  <div className="app-header-context">...</div>
</header>
```

Expected result: Tier 1 renders brand, nav, status, GitHub, dark mode. Tier 2 renders title, hint, and action buttons when `showPrimaryActions` is true.

- [ ] **Step 5: Run TypeScript build to catch prop and import breakage**

Run: `npm run build:ts`
Expected: `tsc` exits successfully


### Task 2: Add Section State And Active-Section Rendering In Dashboard

**Files:**
- Modify: `web/src/Dashboard.tsx`
- Modify: `web/src/components/AiConfigSection.tsx`
- Modify: `web/src/components/ConfigFilesSection.tsx`

**Interfaces:**
- Consumes: `Header` nav contract from Task 1 and `DashboardNavId` from `web/src/components/dashboard-nav.ts`
- Produces: a dashboard that renders only the active section while preserving existing handlers

- [ ] **Step 1: Add active section state near the top of `Dashboard.tsx`**

```ts
const [activeNav, setActiveNav] = useState<DashboardNavId>("overview");
```

- [ ] **Step 2: Define section metadata in `Dashboard.tsx`**

```ts
const sectionMeta = {
  overview: { title: t("dashboardTitle"), hint: t("dashboardSubtitleFull"), actions: false },
  platforms: { title: t("platformsTitle"), hint: t("platformsHint"), actions: true },
  files: { title: t("configFilesTitle"), hint: t("configFilesHint"), actions: true },
  ai: { title: t("aiTitle"), hint: t("aiHint"), actions: true },
} satisfies Record<DashboardNavId, { title: string; hint: string; actions: boolean }>;
```

- [ ] **Step 3: Pass active nav and section metadata into `Header`**

```tsx
<Header
  activeNav={activeNav}
  onNavigate={setActiveNav}
  sectionTitle={sectionMeta[activeNav].title}
  sectionHint={sectionMeta[activeNav].hint}
  showPrimaryActions={sectionMeta[activeNav].actions}
  ...
/>;
```

- [ ] **Step 4: Replace the stacked main content with conditional section rendering**

```tsx
{activeNav === "overview" && <OverviewStats ... />}
{activeNav === "platforms" && <section className="section">...</section>}
{activeNav === "files" && <ConfigFilesSection ... />}
{activeNav === "ai" && <AiConfigSection ... />}
```

Expected result: each destination renders in place without changing existing save, validate, start, stop, or platform test handlers.

- [ ] **Step 5: Keep wizard takeover ahead of navigation rendering**

```tsx
{showWizard ? (
  <SetupWizard ... />
) : (
  <>{/* header-driven section surface */}</>
)}
```

Expected result: first-run wizard still overrides the dashboard shell.

- [ ] **Step 6: Run TypeScript build after the render flow changes**

Run: `npm run build:ts`
Expected: `tsc` exits successfully


### Task 3: Add Header, Tab, And Responsive Styles

**Files:**
- Modify: `web/src/styles/global.css`

**Interfaces:**
- Consumes: new class names from `Header.tsx`
- Produces: a compact two-tier admin header with usable tablet/mobile behavior

- [ ] **Step 1: Replace the old `.header*` rules with two-tier shell styles**

```css
.app-header { ... }
.app-header-main { ... }
.app-header-context { ... }
.app-header-brand { ... }
.app-header-status { ... }
```

- [ ] **Step 2: Add explicit nav tab styles**

```css
.app-nav { display: flex; gap: 6px; }
.app-nav-item { ... }
.app-nav-item.active { ... }
```

Expected result: tabs read as location controls, not generic utility buttons.

- [ ] **Step 3: Add context toolbar layout styles**

```css
.app-context-copy { ... }
.app-context-actions { ... }
```

Expected result: title and hint anchor the section while actions align to the right.

- [ ] **Step 4: Add responsive rules for wrapped top nav and stacked context row**

```css
@media (max-width: 768px) {
  .app-header-main { ... }
  .app-nav { ... }
  .app-header-context { ... }
  .app-context-actions { ... }
}
```

Expected result: service status remains visible and primary actions remain directly clickable on smaller screens.

- [ ] **Step 5: Run web build-focused validation**

Run: `npm run build:ts`
Expected: `tsc` exits successfully


### Task 4: Verify Section Switching And Final Polish

**Files:**
- Modify: `web/src/Dashboard.tsx` (only if a final wiring fix is needed)
- Modify: `web/src/components/Header.tsx` (only if a final wiring fix is needed)
- Modify: `web/src/styles/global.css` (only if a final spacing fix is needed)

**Interfaces:**
- Consumes: completed header/nav implementation from Tasks 1-3
- Produces: a shippable management shell with stable navigation and actions

- [ ] **Step 1: Run a final TypeScript build**

Run: `npm run build:ts`
Expected: `tsc` exits successfully

- [ ] **Step 2: Run a production web bundle build**

Run: `npm run web:build`
Expected: Vite build completes successfully into `web/dist`

- [ ] **Step 3: Review the final diff for scope control**

Run: `git diff -- web/src/components/dashboard-nav.ts web/src/components/Header.tsx web/src/components/Sidebar.tsx web/src/Dashboard.tsx web/src/components/AiConfigSection.tsx web/src/components/ConfigFilesSection.tsx web/src/styles/global.css`
Expected: only header/nav, section rendering, and related style changes appear

- [ ] **Step 4: Commit the implementation**

```bash
git add web/src/components/dashboard-nav.ts web/src/components/Header.tsx web/src/components/Sidebar.tsx web/src/Dashboard.tsx web/src/components/AiConfigSection.tsx web/src/components/ConfigFilesSection.tsx web/src/styles/global.css
git commit -m "feat(web): redesign management top navigation"
```
