import { IcoFiles, IcoOverview, IcoPlatforms, IcoSettings } from "./icons.js";

export const DASHBOARD_NAV_ITEMS = [
  { id: "overview", icon: IcoOverview, label: "概览" },
  { id: "platforms", icon: IcoPlatforms, label: "平台配置" },
  { id: "files", icon: IcoFiles, label: "配置文件" },
  { id: "settings", icon: IcoSettings, label: "设置" },
] as const;

export type DashboardNavId = (typeof DASHBOARD_NAV_ITEMS)[number]["id"];
export type DashboardNavItem = (typeof DASHBOARD_NAV_ITEMS)[number];