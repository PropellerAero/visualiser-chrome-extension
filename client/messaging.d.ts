export type Messages = {
    type: "propeller.getInjectedFeatureFlags";
} | {
    type: "propeller.gotInjectedFeatureFlags";
    flags: Record<string, boolean>;
} | {
    type: "propeller.evaluateFeatureFlag";
    flagName: string;
    flagValue: boolean;
};
/**
 * This function opens the port to the chrome extension. Failures will be reported if the debug flag is set
 * The extension connects to extension `jkcaeplgocjdplbbjgcomaafjgnhpolf` by default but can
 * be supplied an override when developing locally
 *
 * This function must be called as early as possible, preferably in module scope. When called it will
 * * Open a channel to the extension
 * * request feature flag injections
 */
export declare function openPort(editorExtensionId?: string, debug?: boolean): void;
/**
 * Will query any injected feature flags from the chrome extension and return an override if present
 */
export declare function getInjectedFeatureFlagValue(flagName: string, originalValue: boolean): boolean;
/**
 * Listen for changes to feature flags when they are overridden in the
 * chrome extension. Use this to re-mount, or re-render applications.
 *
 * This fails silently to prevent breaking applications when chrome extensions
 * fail to connect. Pass in debug flag to debug.
 */
export declare function listenForFeatureFlagChanges(callback: (flags: Record<string, boolean>) => void, debug?: boolean): () => void;
