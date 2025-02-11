let injectedFeatureFlags = null as null | Record<string, boolean>;
let injectedFlagHash = "";

let messagePort = null as null | chrome.runtime.Port;

export type Messages =
  | {
      type: "propeller.getInjectedFeatureFlags";
    }
  | {
      type: "propeller.gotInjectedFeatureFlags";
      flags: Record<string, boolean>;
    }
  | {
      type: "propeller.evaluateFeatureFlag";
      flagName: string;
      flagValue: boolean;
    };

function sendMessage(message: Messages) {
  try {
    if (messagePort != null) messagePort.postMessage(message);
  } catch (e) {}
}

/**
 * This function opens the port to the chrome extension. Failures will be reported if the debug flag is set
 * The extension connects to extension `jkcaeplgocjdplbbjgcomaafjgnhpolf` by default but can
 * be supplied an override when developing locally
 *
 * This function must be called as early as possible, preferably in module scope. When called it will
 * * Open a channel to the extension
 * * request feature flag injections
 */
export function openPort(
  editorExtensionId: string = "jkcaeplgocjdplbbjgcomaafjgnhpolf",
  debug: boolean = false,
) {
  try {
    if (messagePort != null)
      throw new Error("Attempted to open already opened port");

    if (typeof chrome === "object" && injectedFeatureFlags == null) {
      messagePort = chrome.runtime.connect(editorExtensionId);

      messagePort.onMessage.addListener((message: Messages) => {
        if (message.type === "propeller.gotInjectedFeatureFlags") {
          const nextHash = JSON.stringify(message.flags);
          if (nextHash != injectedFlagHash) {
            injectedFeatureFlags = message.flags;
            injectedFlagHash = nextHash;
            listeners.forEach((l) => l(message.flags));
          }
        }
      });

      sendMessage({
        type: "propeller.getInjectedFeatureFlags",
      });
    }
  } catch (e) {
    if (debug) console.error(e);
  }
}

/**
 * Will query any injected feature flags from the chrome extension and return an override if present
 */
export function getInjectedFeatureFlagValue(
  flagName: string,
  originalValue: boolean,
): boolean {
  const value = injectedFeatureFlags?.[flagName] ?? originalValue;
  if (messagePort != null)
    sendMessage({
      type: "propeller.evaluateFeatureFlag",
      flagName: flagName,
      flagValue: value,
    });

  return value;
}

let listeners: ((flags: Record<string, boolean>) => void)[] = [];
/**
 * Listen for changes to feature flags when they are overridden in the
 * chrome extension. Use this to re-mount, or re-render applications.
 *
 * This fails silently to prevent breaking applications when chrome extensions
 * fail to connect. Pass in debug flag to debug.
 */
export function listenForFeatureFlagChanges(
  callback: (flags: Record<string, boolean>) => void,
  debug = false,
): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((f) => f === callback);
  };
}
