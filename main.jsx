import React from "react";
import { createRoot } from "react-dom/client";
import ComponentPlanner from "./component-planner.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ComponentPlanner />
  </React.StrictMode>,
);
