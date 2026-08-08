"use client";

/**
 * IndexedDB 持久化模块
 *
 * 解决工作流结果刷新丢失问题。自动保存 DetailPageProject（含图片数据），
 * 页面加载时自动恢复。采用 debounce 策略减少写入频率。
 *
 * 数据模型：
 * - persistedProject：完整项目快照（包含图片 ArrayBuffer）
 * - 不含 API Key 等敏感配置（由 provider-store 独立管理）
 * - 不含运行时状态（executionStatuses、runEpoch、workStatus）
 */

import type {
  DetailPageProject,
  WorkflowStage,
  ProjectAsset
} from "@/lib/types";

const DB_NAME = "detail-page-workbench";
const DB_VERSION = 1;
const STORE_NAME = "projects";
const PROJECT_KEY = "current";

type PersistedAsset = {
  id: string;
  name: string;
  /** WebP 压缩后的图片二进制数据 */
  imageBuffer: ArrayBuffer;
  size: number;
};

export type PersistedProject = {
  id: string;
  name: string;
  assets: PersistedAsset[];
  brief: DetailPageProject["brief"];
  research: DetailPageProject["research"];
  plan: DetailPageProject["plan"];
  executions: DetailPageProject["executions"];
  qa: DetailPageProject["qa"];
  stage: WorkflowStage;
  savedAt: string;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
  });
}

async function withStore(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
    // If fn() didn't return a request, resolve on complete
    if (!request) return;
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function withStoreResult<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * 从 blob URL 读取图片数据。如果 URL 不可用（已释放），返回 undefined。
 * 调用方应跳过该资产。
 */
async function readBlobUrlAsBuffer(dataUrl: string): Promise<ArrayBuffer | undefined> {
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) return undefined;
    return response.arrayBuffer();
  } catch {
    return undefined;
  }
}

/**
 * 保存当前项目到 IndexedDB。
 * 图片数据从 blob URL 异步读取后存储为 ArrayBuffer。
 * 如果图片读取失败（URL 已释放），跳过该资产——下次手动保存时再补全。
 */
export async function saveProject(
  project: DetailPageProject,
  stage: WorkflowStage
): Promise<void> {
  const persistedAssets: PersistedAsset[] = [];
  for (const asset of project.assets) {
    const buffer = await readBlobUrlAsBuffer(asset.dataUrl);
    if (buffer) {
      persistedAssets.push({
        id: asset.id,
        name: asset.name,
        imageBuffer: buffer,
        size: asset.size
      });
    }
  }

  const persisted: PersistedProject = {
    id: project.id,
    name: project.name,
    assets: persistedAssets,
    brief: project.brief,
    research: project.research,
    plan: project.plan,
    executions: project.executions,
    qa: project.qa,
    stage,
    savedAt: new Date().toISOString()
  };

  await withStore("readwrite", (store) => {
    store.put(persisted, PROJECT_KEY);
  });
}

/**
 * 从 IndexedDB 读取上次保存的项目。
 * 返回 undefined 表示没有保存的数据。
 */
export async function loadProject(): Promise<PersistedProject | undefined> {
  try {
    return await withStoreResult("readonly", (store) =>
      store.get(PROJECT_KEY)
    );
  } catch {
    return undefined;
  }
}

/**
 * 清除已保存的项目数据。
 */
export async function clearProject(): Promise<void> {
  try {
    await withStore("readwrite", (store) => {
      store.delete(PROJECT_KEY);
    });
  } catch {
    // 静默失败：数据不在时无需报错
  }
}

/**
 * 检查是否有已保存的项目。
 */
export async function hasSavedProject(): Promise<boolean> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.count(PROJECT_KEY);
      request.onsuccess = () => {
        db.close();
        resolve(request.result > 0);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    return false;
  }
}

/**
 * 从 PersistedProject 恢复为运行时 ProjectAsset 列表。
 * ArrayBuffer 重新转为 blob URL。
 */
export function restoreAssets(persisted: PersistedProject): ProjectAsset[] {
  return persisted.assets.map((a) => {
    const blob = new Blob([a.imageBuffer], { type: "image/webp" });
    const dataUrl = URL.createObjectURL(blob);
    return { id: a.id, name: a.name, dataUrl, size: a.size };
  });
}

/**
 * 判断项目是否有可恢复的有效数据。
 * 至少需要已上传素材或已完成图研。
 */
export function projectHasRecoverableData(p: PersistedProject): boolean {
  return p.assets.length > 0 || p.research !== null;
}
