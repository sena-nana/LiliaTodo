// BE-12 sprint-4.3b：WebDAV 凭据/同步配置的持久化抽象。
//
// 为什么单拎一层而不是直接喊 plugin-store：
//   - 测试要能注入内存实现，不能依赖 Tauri 运行时；
//   - 配置序列化与运行期解码集中在这里，UI 层只看 typed 对象；
//   - 未来若把凭据搬去 OS keychain（plugin-keyring）只换实现即可。
//
// secrets 文件以 plugin-store 的方式落到 OS 用户目录（Windows 上是
// %APPDATA%/<bundleId>/momo-webdav-secrets.json），不写浏览器 localStorage。

export interface WebdavSecrets {
  /** WebDAV base URL（含 scheme、host、用户库路径前缀；不带尾斜杠）。 */
  readonly baseUrl: string;
  /** WebDAV 内部根目录，默认 `/momo`。 */
  readonly root: string;
  /** WebDAV 用户名。 */
  readonly username: string;
  /** WebDAV 应用密码（坚果云 → 设置-账户安全-第三方应用授权）。 */
  readonly password: string;
  /** 同步 device id，用于 oplog 文件夹隔离；缺省时由 ensureDeviceId 生成。 */
  readonly deviceId: string;
}

export interface WebdavSecretsStore {
  load(): Promise<WebdavSecrets | null>;
  save(secrets: WebdavSecrets): Promise<void>;
  clear(): Promise<void>;
}

const SECRETS_STORE_FILE = "momo-webdav-secrets.json";
const SECRETS_KEY = "webdav";

interface PluginStoreInstance {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
}

interface PluginStoreModule {
  load(path: string): Promise<PluginStoreInstance>;
}

export interface CreatePluginStoreWebdavSecretsStoreOptions {
  /**
   * 测试或非 Tauri 环境下注入自定义 plugin-store 模块；
   * 生产路径走默认（懒加载 @tauri-apps/plugin-store）。
   */
  readonly pluginStore?: PluginStoreModule;
  readonly storeFile?: string;
  readonly secretsKey?: string;
}

export async function createPluginStoreWebdavSecretsStore(
  options: CreatePluginStoreWebdavSecretsStoreOptions = {},
): Promise<WebdavSecretsStore> {
  const moduleRef = options.pluginStore ?? (await loadPluginStore());
  const filename = options.storeFile ?? SECRETS_STORE_FILE;
  const secretsKey = options.secretsKey ?? SECRETS_KEY;
  const store = await moduleRef.load(filename);

  return {
    async load() {
      const raw = await store.get<unknown>(secretsKey);
      if (raw == null) return null;
      return assertWebdavSecrets(raw);
    },
    async save(secrets) {
      assertWebdavSecrets(secrets);
      await store.set(secretsKey, secrets);
      await store.save();
    },
    async clear() {
      await store.delete(secretsKey);
      await store.save();
    },
  };
}

export function createInMemoryWebdavSecretsStore(
  initial: WebdavSecrets | null = null,
): WebdavSecretsStore {
  let current: WebdavSecrets | null = initial;
  return {
    async load() {
      return current;
    },
    async save(secrets) {
      current = assertWebdavSecrets(secrets);
    },
    async clear() {
      current = null;
    },
  };
}

async function loadPluginStore(): Promise<PluginStoreModule> {
  // 动态 import：避免 vitest/jsdom 等非 Tauri 上下文里因 ESM 解析失败而 throw。
  const dynamicImport = new Function(
    "specifier",
    "return import(specifier);",
  ) as (s: string) => Promise<unknown>;
  const mod = (await dynamicImport("@tauri-apps/plugin-store")) as {
    load?: PluginStoreModule["load"];
    Store?: { load?: PluginStoreModule["load"] };
  };
  const load = mod.load ?? mod.Store?.load;
  if (typeof load !== "function") {
    throw new Error("WebDAV：@tauri-apps/plugin-store 未导出 load");
  }
  return { load };
}

function assertWebdavSecrets(value: unknown): WebdavSecrets {
  if (typeof value !== "object" || value === null) {
    throw new Error("WebDAV 凭据：必须为对象");
  }
  const record = value as Record<string, unknown>;
  const baseUrl = assertNonEmpty(record.baseUrl, "baseUrl");
  const root = assertNonEmpty(record.root, "root");
  const username = assertNonEmpty(record.username, "username");
  const password = assertNonEmpty(record.password, "password");
  const deviceId = assertNonEmpty(record.deviceId, "deviceId");
  return { baseUrl, root, username, password, deviceId };
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`WebDAV 凭据：${field} 缺失`);
  }
  return value;
}
