import { IcoFiles, IcoOverview, IcoPlatforms } from "./icons.js";

export const DASHBOARD_NAV_ITEMS = [
  { id: "overview", icon: IcoOverview, key: "dashboardTitle" },
  { id: "platforms", icon: IcoPlatforms, key: "platformsTitle" },
  { id: "files", icon: IcoFiles, key: "navConfigFiles" },
] as const;

export type DashboardNavId = (typeof DASHBOARD_NAV_ITEMS)[number]["id"];
export type DashboardNavItem = (typeof DASHBOARD_NAV_ITEMS)[number];
