// AB-01：backend 抽象层异常族。
// 业务侧只面对这一族异常，未来真实 transport 接入后亦由其继承或抛出同型异常。

export class BackendDisabledError extends Error {
  readonly code = "BACKEND_DISABLED" as const;
  constructor(detail?: string) {
    super(
      detail
        ? `服务端能力未启用：${detail}`
        : "服务端能力未启用：当前 Momo 一期不接入独立服务端，请在 Settings 中查看启用条件。",
    );
    this.name = "BackendDisabledError";
  }
}

export class BackendUnreachableError extends Error {
  readonly code = "BACKEND_UNREACHABLE" as const;
  constructor(detail?: string) {
    super(detail ? `服务端不可达：${detail}` : "服务端不可达。");
    this.name = "BackendUnreachableError";
  }
}

export class BackendVersionMismatchError extends Error {
  readonly code = "BACKEND_VERSION_MISMATCH" as const;
  constructor(
    readonly capability: string,
    readonly clientVersion: string,
    readonly serverVersion: string | null,
  ) {
    super(
      `服务端能力 ${capability} 版本不匹配：客户端 ${clientVersion}，服务端 ${serverVersion ?? "未声明"}。`,
    );
    this.name = "BackendVersionMismatchError";
  }
}
