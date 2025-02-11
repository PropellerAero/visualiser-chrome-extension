import {
  getCustomInjectionConfig,
  getInjectionRules,
  getInjectionToken,
} from "../common/storage";
import { listenForInjectionChange } from "../common/messages";
import { HEADER_INJECTION_CONFIG } from "../common/headerInjection";

chrome.runtime.onInstalled.addListener(() => {
  setUpInjectionRules();
});

listenForInjectionChange(setUpInjectionRules);

async function setUpInjectionRules() {
  // Get arrays containing new and old rules
  const newRules = await getNewRules();
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  const oldRuleIds = oldRules.map((rule) => rule.id);

  // Use the arrays to update the dynamic rules
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRuleIds.filter((d) => typeof d === "number"),
    addRules: newRules,
  });
}

async function getNewRules(): Promise<chrome.declarativeNetRequest.Rule[]> {
  const token = await getInjectionToken();
  if (token == null) return [];

  const rules = await getInjectionRules();
  const ruleList: chrome.declarativeNetRequest.Rule[] = [];

  if (rules.enabled) {
    ruleList.push({
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "X-Source-XSRF",
            value: token,
            operation: "set",
          },
        ],
      },
      condition: {
        urlFilter: "prpeller.com",
        resourceTypes: ["main_frame", "sub_frame"],
      },
    });

    const customRules = await getCustomInjectionConfig();

    for (const key of Object.keys(customRules)) {
      if (customRules[key]) {
        const v = customRules[key];
        if (!v.enabled) continue;
        ruleList.push({
          id: v.id,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              {
                header: v.headerName,
                value: v.headerValue,
                operation: "set",
              },
            ],
          },
          condition: {
            urlFilter: "prpeller.com",
            resourceTypes: ["main_frame", "sub_frame"],
          },
        });
      }
    }

    for (const injectionKey of Object.keys(HEADER_INJECTION_CONFIG)) {
      if (rules[injectionKey as keyof typeof HEADER_INJECTION_CONFIG]) {
        const v =
          HEADER_INJECTION_CONFIG[
            injectionKey as keyof typeof HEADER_INJECTION_CONFIG
          ];
        ruleList.push({
          id: 2,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              {
                header: v.headerName,
                value: v.headerValue,
                operation: "set",
              },
            ],
          },
          condition: {
            urlFilter: "prpeller.com",
            resourceTypes: ["main_frame", "sub_frame"],
          },
        });
      }
    }
  }
  console.log("Setting intercept rules to", ruleList);
  return ruleList;
}
