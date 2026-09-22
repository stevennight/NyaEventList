import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";
import "./styles/schedule.css";
import "./styles/dictionaries.css";
import "./styles/board.css";
import "./styles/stats.css";
import "./styles/selection.css";
import "./styles/logQuery.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
