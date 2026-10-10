import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { ContextMenuProvider } from "./components/ContextMenu";
import { installInputAssistOff } from "./lib/inputAssist";
import { installNativeContextMenuOff } from "./lib/contextMenu";
import "./index.css";

// 预热内嵌的图标字体（`index.css` 的 "OMP Nerd Icons"）：终端的 omp nerd 图标全靠它，
// 启动时先发起加载，避免第一次打开终端时图标因字体未就绪而空一小会儿。
void document.fonts.load('13px "OMP Nerd Icons"').catch(() => { });

// 关掉系统对输入框的「输入提示」（拼写建议 / 自动大写 / 智能标点 / 自动填充）：
// 现有与之后插入的所有 input / textarea / contenteditable 都会被装饰（含 xterm 的隐藏
// textarea），xterm 挂载后也无需重挂——见 lib/inputAssist.ts。
installInputAssistOff();

// 全 app 禁用系统默认右键菜单（WebView 的重新载入 / 检查元素 / 拼写建议等）：
// 组件自己的右键动作走 React 的 onContextMenu + ContextMenuProvider（顶层单实例菜单），
// 原生监听只负责吞掉默认行为——见 lib/contextMenu.ts。
installNativeContextMenuOff();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* 右键菜单宿主：顶层单实例（左栏树等把菜单项交给它，见 lib/contextMenu.ts） */}
    <ContextMenuProvider>
      <App />
    </ContextMenuProvider>
  </React.StrictMode>,
);
