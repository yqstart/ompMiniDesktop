#!/usr/bin/env node
/**
 * e2e:rpc —— 用 fake-omp 驱一遍**真实行协议**，把 M2 的验收从"人肉联调"变成可回归的脚本：
 * 握手（ready → negotiate_protocol v2）→ get_state → prompt → 审批双分支 → 多工具并行 → 流式中断。
 *
 * 与 `e2e:ipc` 的分工：e2e:ipc 校验前后端名字对不对得上（静态文本契约），
 * 本脚本校验**事件序列与回包语义**对不对（行为契约，脱离真实 LLM 与网络）。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, "fake-omp.mjs");

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};
const assert = (cond, msg) => (cond ? ok(msg) : bad(msg));

/** 跑一个场景：返回收到的全部帧与 response 表。 */
async function drive(scenario, { decide = "approve", abort = false, extra = [], respond, images } = {}) {
  const child = spawn(process.execPath, [FAKE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, OMP_FAKE_SCENARIO: scenario },
  });
  const frames = [];
  const responses = new Map();
  let buf = "";
  let started = false;

  // 子进程已在 agent_end 后被 kill 时，晚到的帧不再回包（否则 EPIPE 会炸掉整个测试进程）
  const send = (o) => {
    if (!child.stdin.writable) return;
    child.stdin.write(`${JSON.stringify(o)}\n`);
  };
  child.stdin.on("error", () => {});
  const settle = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${scenario}: 10s 内没等到 agent_end`)), 10000);
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let f;
        try {
          f = JSON.parse(line);
        } catch {
          bad(`${scenario}: stdout 出现非法 JSON 行：${line.slice(0, 80)}`);
          continue;
        }
        if (!f.type) bad(`${scenario}: 帧缺 type 字段：${line.slice(0, 80)}`);
        frames.push(f);
        if (f.type === "response") responses.set(f.id, f);
        if (f.type === "ready" && !started) {
          started = true;
          send({ id: "n1", type: "negotiate_protocol", protocolVersion: 2 });
          send({ id: "g1", type: "get_state" });
          for (const e of extra) send(e);
          send({ id: "p1", type: "prompt", message: "跑一下 echo", ...(images ? { images } : {}) });
        }
        if (f.type === "extension_ui_request") {
          // respond 回调给"按方法回不同包"的场景用（V2 M5 通用 UI 请求）
          if (respond) respond(f, send);
          else if (decide === "deny") send({ type: "extension_ui_response", id: f.id, cancelled: true });
          else send({ type: "extension_ui_response", id: f.id, value: "Approve" });
        }
        if (f.type === "agent_end" && f.isTerminal !== false) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    child.on("error", reject);
  });
  if (abort) setTimeout(() => send({ type: "abort" }), 200);
  try {
    await settle;
  } finally {
    child.kill("SIGKILL");
  }
  return { frames, responses };
}

const kinds = (frames, type) => frames.filter((f) => f.type === type);

async function main() {
  // --- 1. 握手与基础命令 -------------------------------------------------
  console.log("场景 approve（握手 + 通过分支 + 切模型）");
  const approve = await drive("approve", {
    extra: [
      { id: "m1", type: "set_model", provider: "commandcode", modelId: "claude-haiku-4-5-20251001" },
      { id: "t1", type: "set_thinking_level", level: "off" },
    ],
  });
  assert(approve.responses.get("n1")?.success === true, "negotiate_protocol v2 回 success");
  assert(approve.responses.get("g1")?.success === true, "get_state 回 success 且带 model");
  assert(!!approve.responses.get("g1")?.data?.model, "get_state.data.model 存在（真值回读数据源）");
  assert(approve.responses.get("p1")?.success === true, "prompt 立即 ack（不代表做完）");
  assert(approve.responses.get("m1")?.success === true, "set_model 回 success");
  assert(kinds(approve.frames, "model_changed").length === 1, "set_model 后跟一条 model_changed");
  assert(approve.responses.get("t1")?.success === true, "set_thinking_level 回 success");

  // --- 2. 审批通过分支：工具终态与调用 id 一致（不串卡） -------------------
  const started = kinds(approve.frames, "tool_execution_start");
  const ended = kinds(approve.frames, "tool_execution_end");
  assert(started.length === 1 && ended.length === 1, "通过分支：一次调用一条 start / 一条 end");
  assert(
    started[0]?.toolCallId === ended[0]?.toolCallId,
    "tool_execution_start / end 的 toolCallId 一致（前端据此合并成一张卡）",
  );
  assert(ended[0]?.isError === false, "通过分支：tool_execution_end.isError=false");
  const approveText = kinds(approve.frames, "message_update").find(
    (f) => f.assistantMessageEvent?.type === "text_delta",
  );
  assert(!!approveText, "通过分支：跟进总结有 text_delta 流式");
  assert(kinds(approve.frames, "agent_end")[0]?.isTerminal === true, "agent_end.isTerminal=true 作为完成信号");

  // --- 3. 审批拒绝分支 ---------------------------------------------------
  console.log("场景 deny（拒绝分支）");
  const deny = await drive("deny", { decide: "deny" });
  const denyEnd = kinds(deny.frames, "tool_execution_end")[0];
  assert(denyEnd?.isError === true, "拒绝分支：tool_execution_end.isError=true");
  assert(
    String(denyEnd?.result?.content?.[0]?.text ?? "").includes("denied by user"),
    "拒绝分支：结果文本含 denied by user（前端渲染「被用户拒绝」）",
  );
  assert(kinds(deny.frames, "agent_end").length === 1, "拒绝分支：turn 正常结束，不是中断（有 agent_end）");
  assert(kinds(deny.frames, "agent_end").every((f) => f.isTerminal === true), "拒绝分支：agent_end 为终态");

  // --- 4. 多工具并行：两个不同 toolCallId，一成一败 -----------------------
  console.log("场景 multi（双工具并行）");
  const multi = await drive("multi");
  const multiEnds = kinds(multi.frames, "tool_execution_end");
  const ids = new Set(multiEnds.map((f) => f.toolCallId));
  assert(multiEnds.length === 2, "并行双工具各有一条 tool_execution_end");
  assert(ids.size === 2, "两个工具的 toolCallId 不同（前端各出一张卡，不串卡）");
  assert(
    multiEnds.some((f) => f.isError === false) && multiEnds.some((f) => f.isError === true),
    "两个工具一成一败（覆盖成功态与失败红边）",
  );

  // --- 5. 流式中断 -------------------------------------------------------
  console.log("场景 abort（流式中断）");
  const abortRun = await drive("abort", { abort: true });
  assert(!!abortRun.responses.get("a1") || kinds(abortRun.frames, "agent_end").length === 1, "abort 后补 agent_end 收尾");
  assert(kinds(abortRun.frames, "tool_execution_end").length === 0, "中断发生在工具执行前：没有工具终态事件");
  assert(
    kinds(abortRun.frames, "message_update").some((f) => f.assistantMessageEvent?.type === "thinking_delta"),
    "中断前确有流式输出（不是空跑）",
  );

  // --- 6. 通用 UI 请求（V2 M5）：confirm / input / editor / 非审批 select + 服务端撤回 ---
  console.log("场景 ui（通用 UI 请求全方法）");
  const seenUi = [];
  const uiRun = await drive("ui", {
    respond: (f, send) => {
      // 只有需要回包的方法算一次交互：cancel（服务端撤回）与 notify（单向）都不回包
      if (!["confirm", "input", "editor", "select"].includes(f.method)) return;
      seenUi.push(f.method);
      // 回包语义按方法区分（实测 omp 18.1.22）：confirm 用 {confirmed}，
      // input/editor/非审批 select 用 {value}，cancel 不需要回包。
      if (f.method === "confirm") send({ type: "extension_ui_response", id: f.id, confirmed: true });
      else if (f.method === "input") send({ type: "extension_ui_response", id: f.id, value: "release/2.0" });
      else if (f.method === "editor") send({ type: "extension_ui_response", id: f.id, value: "feat: 二期\n\n- ui 请求" });
      else if (f.method === "select") send({ type: "extension_ui_response", id: f.id, value: "release/2.0" });
    },
  });
  const uiText = kinds(uiRun.frames, "message_update")
    .map((f) => f.assistantMessageEvent?.delta ?? "")
    .join("");
  assert(
    seenUi.slice(0, 4).join(",") === "confirm,input,editor,select",
    "四类交互请求按序到达（confirm → input → editor → select；第 5 条是被撤回的那张）",
  );
  assert(uiText.includes("confirm=true"), "confirm 回包用 {confirmed:true}（不是审批的 {value:\"Approve\"}）");
  assert(uiText.includes("input=release/2.0"), "input 回包用 {value}，原样透传");
  assert(uiText.includes("editor=feat: 二期||- ui 请求"), "editor 回包用 {value} 且换行保留");
  assert(uiText.includes("select=release/2.0"), "非审批 select 回包是选中项");
  const cancelFrame = kinds(uiRun.frames, "extension_ui_request").find((f) => f.method === "cancel");
  assert(cancelFrame?.targetId === "ui-x1", "服务端撤回帧带 targetId（前端据此撤掉卡片）");
  assert(kinds(uiRun.frames, "agent_end").length === 1, "UI 请求处理完 turn 正常收尾");

  // --- 7. 图片附件（V2 M6）：prompt.images 与文本一起发，字段照 omp 的 image 内容块 ---
  console.log("场景 approve + 图片附件");
  // 1x1 透明 PNG（真实 base64，仅用于验证线路形状；fake-omp 不做解码）
  const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const withImg = await drive("approve", { images: [{ type: "image", data: TINY_PNG, mimeType: "image/png" }] });
  const imgText = kinds(withImg.frames, "message_update")
    .map((f) => f.assistantMessageEvent?.delta ?? "")
    .join("");
  assert(imgText.includes("images=1"), "prompt.images 与消息一起被上游收到（图片数与发送一致）");
  const plain = kinds(approve.frames, "message_update")
    .map((f) => f.assistantMessageEvent?.delta ?? "")
    .join("");
  assert(!plain.includes("images="), "不带图片时 prompt 里没有 images 字段（不塞空数组）");

  // --- 8. @文件 提及（V2 M6b）：omp 自动读文件后落的 fileMention 消息 ---
  console.log("场景 mentions（@文件 提及）");
  const mentions = await drive("mentions");
  const fmFrames = kinds(mentions.frames, "message_start").filter((f) => f.message?.role === "fileMention");
  assert(fmFrames.length === 1, "fileMention 消息按 markdown 之外的独立角色出现（前端归一成一排芯片）");
  assert(
    fmFrames[0]?.message?.files?.[0]?.path === "docs/rpc-memo.md" && fmFrames[0]?.message?.files?.[0]?.lineCount === 69,
    "fileMention.files 带 path 与 lineCount（芯片上显示行数）",
  );
  assert(
    fmFrames[0]?.message?.files?.[1]?.skippedReason === "tooLarge",
    "被跳过的文件带 skippedReason（芯片按 warn 色标出，避免以为读进去了）",
  );

  if (failures > 0) {
    console.error(`\ne2e:rpc 失败：${failures} 项断言未通过`);
    process.exit(1);
  }
  console.log("\ne2e:rpc 通过：握手 / 通过分支 / 拒绝分支 / 多工具并行 / 流式中断 / 通用 UI 请求 / 图片附件 / @文件 提及");
}

main().catch((e) => {
  console.error(`e2e:rpc 异常：${e.message}`);
  process.exit(1);
});
