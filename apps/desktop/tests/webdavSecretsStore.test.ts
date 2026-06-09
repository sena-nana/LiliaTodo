import { describe, expect, it } from "vitest";
import {
  createInMemoryWebdavSecretsStore,
  createPluginStoreWebdavSecretsStore,
  type WebdavSecrets,
} from "../src/sync/webdav/secretsStore";

function makeSecrets(overrides: Partial<WebdavSecrets> = {}): WebdavSecrets {
  return {
    baseUrl: "https://dav.jianguoyun.com/dav",
    root: "/liliatodo",
    username: "user@example.com",
    password: "app-secret",
    deviceId: "desk-abcdef",
    ...overrides,
  };
}

describe("WebDAV 凭据 in-memory store", () => {
  it("初值为空时 load 返回 null，save 后能取回，clear 后又为空", async () => {
    const store = createInMemoryWebdavSecretsStore();
    expect(await store.load()).toBeNull();

    const secrets = makeSecrets();
    await store.save(secrets);
    expect(await store.load()).toEqual(secrets);

    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it("接受初始凭据并能被覆盖", async () => {
    const initial = makeSecrets();
    const store = createInMemoryWebdavSecretsStore(initial);
    expect(await store.load()).toEqual(initial);

    const next = makeSecrets({ username: "next-user", password: "next-secret" });
    await store.save(next);
    expect(await store.load()).toEqual(next);
  });

  it("save 时缺字段直接抛错，避免存入脏数据", async () => {
    const store = createInMemoryWebdavSecretsStore();
    await expect(
      store.save({ ...makeSecrets(), username: "" }),
    ).rejects.toThrow(/username/);
    await expect(
      store.save({ ...makeSecrets(), password: "   " }),
    ).rejects.toThrow(/password/);
    expect(await store.load()).toBeNull();
  });
});

describe("WebDAV 凭据 plugin-store 包装", () => {
  it("写入时调用 plugin-store 的 set+save，读取时校验字段后返回", async () => {
    const calls: Array<["set" | "save" | "delete" | "get", unknown]> = [];
    let stored: unknown = undefined;
    const pluginStore = {
      async load(path: string) {
        calls.push(["get", path]);
        return {
          async get<T>(key: string): Promise<T | undefined> {
            calls.push(["get", key]);
            return stored as T | undefined;
          },
          async set(key: string, value: unknown): Promise<void> {
            calls.push(["set", { key, value }]);
            stored = value;
          },
          async delete(key: string): Promise<boolean> {
            calls.push(["delete", key]);
            stored = undefined;
            return true;
          },
          async save(): Promise<void> {
            calls.push(["save", null]);
          },
        };
      },
    };

    const store = await createPluginStoreWebdavSecretsStore({ pluginStore });
    const secrets = makeSecrets();
    await store.save(secrets);
    expect(await store.load()).toEqual(secrets);

    await store.clear();
    expect(await store.load()).toBeNull();

    // 关注关键交互：load 必须落盘（set+save），clear 必须 delete+save
    const setIndex = calls.findIndex(([k]) => k === "set");
    const saveAfterSet = calls.findIndex(
      ([k], i) => k === "save" && i > setIndex,
    );
    expect(setIndex).toBeGreaterThanOrEqual(0);
    expect(saveAfterSet).toBeGreaterThan(setIndex);

    const deleteIndex = calls.findIndex(([k]) => k === "delete");
    const saveAfterDelete = calls.findIndex(
      ([k], i) => k === "save" && i > deleteIndex,
    );
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(saveAfterDelete).toBeGreaterThan(deleteIndex);
  });

  it("plugin-store 返回非对象数据时 load 抛错", async () => {
    const pluginStore = {
      async load() {
        return {
          async get<T>(): Promise<T | undefined> {
            return "not-an-object" as unknown as T;
          },
          async set(): Promise<void> {},
          async delete(): Promise<boolean> {
            return true;
          },
          async save(): Promise<void> {},
        };
      },
    };
    const store = await createPluginStoreWebdavSecretsStore({ pluginStore });
    await expect(store.load()).rejects.toThrow(/必须为对象/);
  });

  it("自定义 storeFile 与 secretsKey 透传到 plugin-store", async () => {
    let observedFile = "";
    let observedKey = "";
    const pluginStore = {
      async load(file: string) {
        observedFile = file;
        return {
          async get<T>(key: string): Promise<T | undefined> {
            observedKey = key;
            return undefined;
          },
          async set(): Promise<void> {},
          async delete(): Promise<boolean> {
            return true;
          },
          async save(): Promise<void> {},
        };
      },
    };
    const store = await createPluginStoreWebdavSecretsStore({
      pluginStore,
      storeFile: "custom.json",
      secretsKey: "alt",
    });
    await store.load();
    expect(observedFile).toBe("custom.json");
    expect(observedKey).toBe("alt");
  });
});
