const INJECTION_CHANGE = "INJECTION_CHANGE";
const FEATURE_FLAG_EVAL = "FEATURE_FLAG_EVAL";

type Messages =
  | { type: typeof INJECTION_CHANGE }
  | { type: typeof FEATURE_FLAG_EVAL; flagName: string; flagValue: unknown };

function sendMessage(message: Messages) {
  chrome.runtime.sendMessage(message);
}

export function notifyInjectionChange() {
  sendMessage({ type: INJECTION_CHANGE });
}

export function listenForInjectionChange(callback: () => unknown) {
  chrome.runtime.onMessage.addListener((message: Messages) => {
    if (message.type === INJECTION_CHANGE) {
      callback();
      return true;
    }
  });
}
