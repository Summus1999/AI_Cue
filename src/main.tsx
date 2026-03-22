import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { perfAppBootstrapStart } from "./services/perf/perfInstrumentation";

// 记录应用启动开始
perfAppBootstrapStart();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
