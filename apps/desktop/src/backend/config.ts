// AB-01：服务端运行期配置。
// 一期所有字段允许为空——backend 默认 noop。未来阶段对接服务端时由 Settings/secure storage 填充。

export interface BackendConfig {
  endpoint: string | null;
  token: string | null;
}

export const disabledBackendConfig: BackendConfig = {
  endpoint: null,
  token: null,
};

export function isBackendConfigured(config: BackendConfig): boolean {
  return Boolean(config.endpoint && config.endpoint.length > 0);
}
