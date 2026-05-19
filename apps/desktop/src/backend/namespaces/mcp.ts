// AB-01：backend.mcp 命名空间——服务端 MCP 工具调用入口。一期 noop。

import { BackendDisabledError } from "../errors";

export interface McpServerInfo {
  id: string;
  name: string;
  version: string;
  tools: string[];
}

export interface BackendMcp {
  listServers(): Promise<McpServerInfo[]>;
  invoke<TParams = unknown, TResult = unknown>(
    serverId: string,
    tool: string,
    params: TParams,
  ): Promise<TResult>;
}

export const noopBackendMcp: BackendMcp = {
  async listServers() {
    throw new BackendDisabledError("mcp.listServers");
  },
  async invoke() {
    throw new BackendDisabledError("mcp.invoke");
  },
};
