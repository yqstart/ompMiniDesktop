/** RPC 线路类型（docs/rpc-memo.md 最小命令集，V1 只用这些）。 */

export type RpcCommand =
  | { id?: string; type: "negotiate_protocol"; protocolVersion: 2 }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "prompt"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "set_thinking_level"; level: string }
  | { id?: string; type: "get_available_models" }
  | { id?: string; type: "switch_session"; sessionPath: string }
  | { id?: string; type: "get_messages_page"; cursor?: string; limit?: number }
  | { id?: string; type: "bash"; command: string };

export type RpcUiResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

/** stdout 帧：ready / response / 会话事件 / UI 请求 / chunk。 */
export type RpcFrame =
  | { type: "ready"; protocolVersion: number; supportedProtocolVersions?: number[] }
  | { id?: string; type: "response"; command: string; success: boolean; error?: string; data?: unknown }
  | { type: "rpc_chunk"; chunkId: string; index: number; count: number; byteLength: number; data: string }
  | { type: string; [k: string]: unknown };
