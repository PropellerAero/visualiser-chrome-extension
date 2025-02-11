"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listenForFeatureFlagChanges = exports.getInjectedFeatureFlagValue = exports.openPort = void 0;
var injectedFeatureFlags = null;
var injectedFlagHash = "";
var messagePort = null;
function sendMessage(message) {
    try {
        if (messagePort != null)
            messagePort.postMessage(message);
    }
    catch (e) { }
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
function openPort(editorExtensionId, debug) {
    if (editorExtensionId === void 0) { editorExtensionId = "jkcaeplgocjdplbbjgcomaafjgnhpolf"; }
    if (debug === void 0) { debug = false; }
    try {
        if (messagePort != null)
            throw new Error("Attempted to open already opened port");
        if (typeof chrome === "object" && injectedFeatureFlags == null) {
            messagePort = chrome.runtime.connect(editorExtensionId);
            messagePort.onMessage.addListener(function (message) {
                if (message.type === "propeller.gotInjectedFeatureFlags") {
                    var nextHash = JSON.stringify(message.flags);
                    if (nextHash != injectedFlagHash) {
                        injectedFeatureFlags = message.flags;
                        injectedFlagHash = nextHash;
                        listeners.forEach(function (l) { return l(message.flags); });
                    }
                }
            });
            sendMessage({
                type: "propeller.getInjectedFeatureFlags",
            });
        }
    }
    catch (e) {
        if (debug)
            console.error(e);
    }
}
exports.openPort = openPort;
/**
 * Will query any injected feature flags from the chrome extension and return an override if present
 */
function getInjectedFeatureFlagValue(flagName, originalValue) {
    var _a;
    var value = (_a = injectedFeatureFlags === null || injectedFeatureFlags === void 0 ? void 0 : injectedFeatureFlags[flagName]) !== null && _a !== void 0 ? _a : originalValue;
    if (messagePort != null)
        sendMessage({
            type: "propeller.evaluateFeatureFlag",
            flagName: flagName,
            flagValue: value,
        });
    return value;
}
exports.getInjectedFeatureFlagValue = getInjectedFeatureFlagValue;
var listeners = [];
/**
 * Listen for changes to feature flags when they are overridden in the
 * chrome extension. Use this to re-mount, or re-render applications.
 *
 * This fails silently to prevent breaking applications when chrome extensions
 * fail to connect. Pass in debug flag to debug.
 */
function listenForFeatureFlagChanges(callback, debug) {
    if (debug === void 0) { debug = false; }
    listeners.push(callback);
    return function () {
        listeners = listeners.filter(function (f) { return f === callback; });
    };
}
exports.listenForFeatureFlagChanges = listenForFeatureFlagChanges;
