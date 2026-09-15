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
async function drive(scenario, { decide = "approve", abort = false, extra = [] } = {}) {
  const child = spawn(process.execPath, [FAKE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, OMP_FAKE_SCENARIO: scenario },
  });
  const frames = [];
  const responses = new Map();
  let buf = "";
  let started = false;

  const send = (o) => child.stdin.write(`${JSON.stringify(o)}\n`);
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
          send({ id: "p1", type: "prompt", message: "跑一下 echo" });
        }
        if (f.type === "extension_ui_request") {
          if (decide === "deny") send({ type: "extension_ui_response", id: f.id, cancelled: true });
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

  if (failures > 0) {
    console.error(`\ne2e:rpc 失败：${failures} 项断言未通过`);
    process.exit(1);
  }
  console.log("\ne2e:rpc 通过：握手 / 通过分支 / 拒绝分支 / 多工具并行 / 流式中断");
}

main().catch((e) => {
  console.error(`e2e:rpc 异常：${e.message}`);
  process.exit(1);
});
