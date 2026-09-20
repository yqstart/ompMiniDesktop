import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./index.css";

// 预热内嵌的图标字体（`index.css` 的 "OMP Nerd Icons"）：终端的 omp nerd 图标全靠它，
// 启动时先发起加载，避免第一次打开终端时图标因字体未就绪而空一小会儿。
void document.fonts.load('13px "OMP Nerd Icons"').catch(() => { });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
