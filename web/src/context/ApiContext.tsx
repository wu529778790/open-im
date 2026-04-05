import { createContext, useContext, type ReactNode } from "react";
import type { JsonRequest } from "../api.js";

const ApiContext = createContext<JsonRequest | null>(null);

export function ApiProvider({ request, children }: { request: JsonRequest; children: ReactNode }) {
  return <ApiContext.Provider value={request}>{children}</ApiContext.Provider>;
}

export function useApi(): JsonRequest {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used within ApiProvider");
  return ctx;
}
