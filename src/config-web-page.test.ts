import { describe, expect, it } from "vitest";
import { getConfigWebLandingHtml } from "./config-web-page.js";
import { getPublicWebDashboardUrl, PUBLIC_WEB_DASHBOARD_DEFAULT } from "./constants.js";

describe("config web landing page", () => {
  it("does not embed legacy full-dashboard markers", () => {
    const html = getConfigWebLandingHtml();
    expect(html).not.toContain("__PAGE_TEXTS__");
    expect(html).not.toContain("heroBodyFull");
    expect(html).not.toContain("Local AI bridge");
  });

  it("links to the public web dashboard URL", () => {
    const url = getPublicWebDashboardUrl();
    const html = getConfigWebLandingHtml();
    expect(html).toContain(url);
    expect(url).toContain("open-im");
  });

  it("includes API origin script hook", () => {
    const html = getConfigWebLandingHtml();
    expect(html).toContain('id="api"');
    expect(html).toContain("location.origin");
  });

  it("defaults public dashboard host", () => {
    expect(PUBLIC_WEB_DASHBOARD_DEFAULT).toBe("https://open-im.shenzjd.com");
  });
});
