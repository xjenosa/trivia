import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../common/brand.css";
import "../arena/projector.css";
import "./screen.css";
import { Projector } from "../arena/Projector";
import { Board2D } from "./Board2D";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Projector Board={Board2D} mode="2d" />
  </StrictMode>,
);
