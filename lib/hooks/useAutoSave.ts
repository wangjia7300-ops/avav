"use client";

import { useEffect, useRef } from "react";
import { useSkillSuiteStore } from "@/lib/skill-suite/store";
import { saveProject, clearProject } from "@/lib/persistence";

const SAVE_DEBOUNCE_MS = 2000;

/**
 * 自动保存钩子。
 * 监听 store 中 project + stage 的变化，debounce 后写入 IndexedDB。
 * 仅在 workStatus !== "running" 时保存（避免写入中间态）。
 */
export function useAutoSave() {
  const projectRef = useRef(useSkillSuiteStore.getState().project);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = useSkillSuiteStore.subscribe((state) => {
      const current = state.project;
      const prev = projectRef.current;

      // 仅在 project 或 stage 变化且非运行态时触发
      if (
        current === prev ||
        state.workStatus === "running"
      ) {
        return;
      }

      projectRef.current = current;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        saveProject(current, state.stage).catch(() => {
          // 静默失败：持久化不是关键路径
        });
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}

/**
 * 手动清除持久化数据（新建项目时调用）。
 */
export async function clearPersistedProject() {
  await clearProject();
}
