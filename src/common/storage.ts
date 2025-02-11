import { notifyInjectionChange } from "./messages";
import {
  CustomHeaderInjectionConfig,
  HEADER_INJECTION_CONFIG,
} from "./headerInjection";

export async function getInjectionToken(): Promise<string | null> {
  const token = await chrome.storage.local.get("injection.token");

  return token["injection.token"] ?? null;
}

export async function setInjectionToken(value: string): Promise<string> {
  await chrome.storage.local.set({
    "injection.token": value,
  });
  notifyInjectionChange();

  return value;
}

export type InjectionRules = Record<
  keyof typeof HEADER_INJECTION_CONFIG,
  boolean
> & { enabled: boolean };

export async function getInjectionRules(): Promise<InjectionRules> {
  const token = await chrome.storage.local.get("injection.rules");

  return (
    token["injection.rules"] ?? {
      enabled: false,
      visualiserDesktop: false,
    }
  );
}

export async function setInjectionRules(
  rules: InjectionRules,
): Promise<InjectionRules> {
  await chrome.storage.local.set({
    "injection.rules": rules,
  });
  notifyInjectionChange();

  return rules;
}

export async function saveCustomInjectionConfig(
  record:
    | (CustomHeaderInjectionConfig[string] & { mode?: "add" })
    | { id: number; mode: "delete" },
): Promise<CustomHeaderInjectionConfig> {
  const records = await chrome.storage.local.get("injection.custom_rules");
  const existing =
    records["injection.custom_rules"] ?? ({} as CustomHeaderInjectionConfig);

  if (record.mode === "delete") delete existing[`${record.id}`];
  else existing[`${record.id}`] = record;
  await chrome.storage.local.set({
    "injection.custom_rules": existing,
  });

  notifyInjectionChange();

  return existing;
}

export async function getCustomInjectionConfig(): Promise<CustomHeaderInjectionConfig> {
  const records = await chrome.storage.local.get("injection.custom_rules");
  return (
    records["injection.custom_rules"] ?? ({} as CustomHeaderInjectionConfig)
  );
}

export async function setFeatureFlagEvals(evals: Record<string, boolean>) {
  await chrome.storage.session.set({
    "feature_flags.evals": evals,
  });
}

export function getThenListenForFlagEvals(
  callback: (evals: Record<string, boolean>) => void,
) {
  // initial get

  const cb = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes["feature_flags.evals"] != null) {
      callback(changes["feature_flags.evals"].newValue);
    }
  };
  chrome.storage.onChanged.addListener(cb);

  (async function getSubscribe() {
    const value = await chrome.storage.session.get("feature_flags.evals");
    if (value["feature_flags.evals"]) callback(value["feature_flags.evals"]);
  })();

  return () => chrome.storage.onChanged.removeListener(cb);
}

export async function getFeatureFlagOverrides() {
  const records = await chrome.storage.session.get("feature_flags.overrides");
  return records["feature_flags.overrides"] ?? ({} as Record<string, boolean>);
}

export async function getAndListenForFeatureFlagOverrides(
  callback: (evals: Record<string, boolean>) => void,
) {
  // initial get

  const cb = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes["feature_flags.overrides"] != null) {
      callback(changes["feature_flags.overrides"].newValue);
    }
  };
  chrome.storage.onChanged.addListener(cb);

  (async function getSubscribe() {
    const value = await chrome.storage.session.get("feature_flags.overrides");
    if (value["feature_flags.overrides"])
      callback(value["feature_flags.overrides"]);
  })();

  return () => chrome.storage.onChanged.removeListener(cb);
}

export async function setFeatureFlagOverrides(
  partials: Record<string, boolean>,
) {
  const existing = await getFeatureFlagOverrides();
  const next = { ...existing, ...partials };

  await chrome.storage.session.set({
    "feature_flags.overrides": next,
  });

  return next;
}

export async function clearFeatureFlagOverride(flagName: string) {
  const existing = await getFeatureFlagOverrides();
  delete existing[flagName];
  await chrome.storage.session.set({
    "feature_flags.overrides": existing,
  });

  return existing;
}
