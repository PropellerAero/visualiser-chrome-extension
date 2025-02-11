import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
  getCustomInjectionConfig,
  getFeatureFlagOverrides,
  getInjectionRules,
  getInjectionToken,
  InjectionRules,
  saveCustomInjectionConfig,
  setFeatureFlagOverrides,
  setInjectionRules,
  setInjectionToken,
} from "../../common/storage";
import { i } from "vite/dist/node/types.d-aGj9QkWt";

export function useActiveTab() {
  const queryClient = useQueryClient();

  const data = useQuery({
    queryKey: ["storage", "app", "activeTab"],
    queryFn: async () =>
      (await chrome.storage.session.get("app.activeTab"))["app.activeTab"] as
        | number
        | null,
  });

  const mut = useMutation({
    mutationFn: (v: number) =>
      chrome.storage.session.set({
        "app.activeTab": v,
      }),
    onMutate: (v) => {
      const old = queryClient.getQueryData(["storage", "app", "activeTab"]);
      queryClient.setQueryData(["storage", "app", "activeTab"], () => v);

      return { rollback: old };
    },
    onError: (err, newTodo, context) => {
      if (context)
        queryClient.setQueryData(
          ["storage", "app", "activeTab"],
          context.rollback,
        );
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ["storage", "app", "activeTab"],
      }),
  });

  return useAsyncState(
    ["storage", "app", "activeTab"],
    async () =>
      (await chrome.storage.session.get("app.activeTab"))["app.activeTab"] as
        | number
        | null,
    async (v: number) => {
      await chrome.storage.session.set({
        "app.activeTab": v,
      });
      return v;
    },
  );
}

export function useInjectionToken() {
  return useAsyncState(
    ["storage", "injectionToken"],
    getInjectionToken,
    setInjectionToken,
  );
}

export function useInjectionRules() {
  return useAsyncState(
    ["storage", "injectionRules"],
    getInjectionRules,
    async (partial: Partial<InjectionRules>) => {
      const current = await getInjectionRules();
      const updated = { ...current, ...partial };
      return setInjectionRules(updated);
    },
  );
}

export function useCustomInjectionRules() {
  return useAsyncState(
    ["storage", "injectionRules", "custom"],
    getCustomInjectionConfig,
    saveCustomInjectionConfig,
    async (v, exist) => {
      if (v.id && v.mode === "add") {
        exist[v.id] = v;
      }

      return exist;
    },
  );
}

export function useFeatureFlagOverrides() {
  return useAsyncState(
    ["featureFlags", "overrides"],
    getFeatureFlagOverrides,
    setFeatureFlagOverrides,
  );
}

function useAsyncState<T, S>(
  queryKey: string[],
  getter: () => Promise<T>,
  setter: (value: S) => Promise<T>,
  optimisticUpdate?: (payload: S, currentState: T) => Promise<T>,
) {
  const queryClient = useQueryClient();

  const data = useQuery({
    queryKey: queryKey,
    queryFn: getter,
  });

  const mut = useMutation({
    mutationFn: setter,
    onMutate: async (v) => {
      await queryClient.cancelQueries(queryKey);
      const old = queryClient.getQueryData(queryKey) as T;

      if (optimisticUpdate) {
        const next = await optimisticUpdate(v, old);
        queryClient.setQueryData(queryKey, () => next);
        return { rollback: old };
      }

      if (typeof old === "object")
        queryClient.setQueryData(queryKey, (old: unknown) => ({
          ...(old as T),
          ...v,
        }));
      else if (typeof v === typeof old)
        queryClient.setQueryData(queryKey, () => v);

      return { rollback: old };
    },
    onError: (err, newTodo, context) => {
      if (context) queryClient.setQueryData(queryKey, context.rollback);
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKey,
      }),
  });

  return [data, mut.mutate] as const;
}
