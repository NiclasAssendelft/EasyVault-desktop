import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

const root = document.getElementById("app");
if (!root) throw new Error("#app not found");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
