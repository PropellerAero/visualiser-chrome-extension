import type { Messages as MessagesExternal } from "../../client/messaging";
import {
  getAndListenForFeatureFlagOverrides,
  setFeatureFlagEvals,
} from "../common/storage";

const messageEvalCache: Record<number, Record<string, boolean>> = {};

chrome.runtime.onConnectExternal.addListener((port) => {
  function sendMessage(message: MessagesExternal) {
    port.postMessage(message);
  }

  console.log("Tab connected");

  port.onMessage.addListener(async (message: MessagesExternal, port) => {
    if (message.type === "propeller.getInjectedFeatureFlags")
      getAndListenForFeatureFlagOverrides((flags) => {
        console.log("Propagating feature flag change", flags);
        sendMessage({
          type: "propeller.gotInjectedFeatureFlags",
          flags,
        });
      });
    else if (message.type === "propeller.evaluateFeatureFlag") {
      const sender = port.sender?.tab?.id;
      if (sender) {
        const cache = messageEvalCache[sender] ?? {};
        if (cache[message.flagName] !== message.flagValue) {
          cache[message.flagName] = message.flagValue;
          messageEvalCache[sender] = cache;

          console.log("Feature flag evaluations", cache);

          setFeatureFlagEvals(cache);
        }
      }
    }
  });
});
