import {
  Button,
  CircularProgress,
  Paper,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import {
  Environment,
  ENVIRONMENT_HOSTS,
  ENVIRONMENT_LABLES,
  getTabEnvironment,
} from "../../common/navigation";
import { useEffect, useState } from "react";

export function Navigator() {
  const tab = useActiveTab();
  if (tab == null) return <CircularProgress />;

  const env = getTabEnvironment(tab);
  return (
    <Stack spacing={1}>
      <Paper sx={{ padding: 2 }}>
        Environment: {env != null && ENVIRONMENT_LABLES[env]}
        <Stack direction="row">
          {env !== Environment.Dev && (
            <Button
              size="small"
              onClick={() => switchEnvironmentTo(tab, Environment.Dev)}
            >
              Switch to Dev
            </Button>
          )}
          {env !== Environment.Staging && (
            <Button
              onClick={() => switchEnvironmentTo(tab, Environment.Staging)}
              size="small"
            >
              Switch to Staging
            </Button>
          )}
          {env !== Environment.Production && (
            <Button
              onClick={() => switchEnvironmentTo(tab, Environment.Production)}
              size="small"
            >
              Switch to Production
            </Button>
          )}
        </Stack>
      </Paper>
      <VisualiserTools />
    </Stack>
  );
}

async function switchEnvironmentTo(tab: chrome.tabs.Tab, toEnv: Environment) {
  if (tab?.url == null) return;
  const url = new URL(tab.url);
  const portal = url.hostname.split(".")[0];
  const uri = url.pathname;

  await chrome.tabs.update({
    url: `https://${portal}.${ENVIRONMENT_HOSTS[toEnv]}${uri}`,
  });
  chrome.runtime.reload();
}

export function useActiveTab(): chrome.tabs.Tab | null {
  const [tabs, setTabs] = useState<null | chrome.tabs.Tab>(null);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      setTabs(tabs[0] ?? null);
    });
  }, []);

  // TODO: synchronise this with tab changes / navigations

  return tabs;
}

function VisualiserTools() {
  const currentTab = useActiveTab();
  const [branchName, setBranchName] = useState("");

  if (currentTab == null) return null;
  const isVisualiser = /\/p\/viewer|viewer-mobile\//.test(currentTab.url ?? "");

  if (!isVisualiser) return null;
  const url = currentTab.url;
  if (url == null) return null;

  const device = /\/viewer-mobile\//.test(url) ? "mobile" : "desktop";

  return (
    <>
      <Paper sx={{ padding: 2 }}>
        <Stack direction="row" gap={1} sx={{ marginTop: 2 }}>
          <TextField
            value={branchName}
            onChange={(ev) => setBranchName(ev.target.value)}
            label="Go to branch"
            fullWidth
            size="small"
          />
          <Button
            onClick={() => {
              const urlObject = new URL(url);
              urlObject.search = `?test-visualiser-dev-branch=${encodeURIComponent(branchName)}`;
              chrome.tabs.update({ url: urlObject.toString() });
            }}
            disabled={!branchName}
            size="small"
          >
            Go to Branch
          </Button>
        </Stack>
      </Paper>
      <Paper sx={{ padding: 2 }}>
        Device: {device}
        <Stack direction="row">
          <Button
            size="small"
            onClick={() => {
              chrome.tabs.update({
                url:
                  device === "mobile"
                    ? url.replace("/viewer-mobile/", "/viewer/")
                    : url.replace("/viewer/", "/viewer-mobile/"),
              });
              chrome.runtime.reload();
            }}
          >
            Switch to {device === "mobile" ? "desktop" : "mobile"}
          </Button>
        </Stack>
      </Paper>
    </>
  );
}
