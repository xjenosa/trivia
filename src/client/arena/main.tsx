import { createRoot } from "react-dom/client";
import "../common/brand.css";
import "./projector.css";
import "./arena.css";
import { Board3D } from "./Board3D";
import { Projector } from "./Projector";

// No StrictMode here: its double mount would build the WebGL scene twice on one canvas.
createRoot(document.getElementById("root")!).render(<Projector Board={Board3D} mode="3d" />);
