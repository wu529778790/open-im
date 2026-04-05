import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { STORAGE_KEY_DARK_MODE } from "./constants.js";
import "./styles/global.css";

const dm = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY_DARK_MODE) : null;
if (typeof document !== "undefined") {
  if (dm === "true") document.documentElement.classList.add("dark");
  else if (dm === "false") document.documentElement.classList.remove("dark");
  else if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.classList.add("dark");
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
