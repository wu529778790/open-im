import { describe, expect, it } from "vitest";
import { getConfigWebLandingHtml } from "./config-web-page.js";
import { getDefaultLocalDashboardUrl, getPublicWebDashboardUrl } from "./constants.js";

describe("config web landing page", () => {
  it("does not embed legacy full-dashboard markers", () => {
    const html = getConfigWebLandingHtml();
    expect(html).not.toContain("__PAGE_TEXTS__");
    expect(html).not.toContain("heroBodyFull");
    expect(html).not.toContain("Local AI bridge");
  });

  it("links to the dashboard URL and explains missing bundle", () => {
    const url = getPublicWebDashboardUrl();
    const html = getConfigWebLandingHtml();
    expect(html).toContain(url);
    expect(html).toContain("web/dist");
  });

  it("includes API origin script hook", () => {
    const html = getConfigWebLandingHtml();
    expect(html).toContain('id="api"');
    expect(html).toContain("location.origin");
  });

  it("defaults public dashboard to local http", () => {
    expect(getDefaultLocalDashboardUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(getPublicWebDashboardUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
