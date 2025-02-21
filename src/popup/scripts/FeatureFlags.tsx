import { useEffect, useState } from "react";
import {
  Button,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  initializeClient,
  getFeatureFlagValue,
} from "@propelleraero/launch-darkly-client";
import { HStack } from "./common/HStack";
import { ContentCopy } from "@mui/icons-material";

// @ts-expect-error
const envKey = import.meta.env.VITE_LD_ENVKEY || "";

export default function FeatureFlags() {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    setFlags({});
    if (!envKey) {
      throw new Error("Missing VITE_LD_ENVKEY in .env");
    }

    initializeClient(
      { launchDarklyClientSideID: envKey, timeoutInMilliseconds: 5000 },
      {
        email: "",
        id: "",
        firstName: "",
        lastName: "",
        isSuperUser: true,
      },
      {
        organizationId: "",
      }
    )
      .then(() => {
        return getFeatureFlagValue(
          "xyz-123-test-feature-flag-for-chrome-ext",
          false
        );
      })
      .then((flag) => {
        console.log("got ", flag);
        setFlags({ "xyz-123-test-feature-flag-for-chrome-ext": flag });
      });
  }, []);

  return (
    <Stack spacing={1}>
      <TextField
        fullWidth
        size="small"
        label="Search"
        value={search}
        onChange={(ev) => setSearch(ev.target.value)}
      />
      <Stack
        spacing={1}
        sx={{ maxHeight: 300, overflowY: "auto", marginBottom: 4 }}
      >
        {Object.keys(flags)
          .filter((value) => (search ? value.includes(search) : true))
          .map((flag) => {
            return (
              <Paper sx={{ padding: 2 }} key={flag}>
                <HStack justifyContent="space-between" alignItems="center">
                  <Stack>
                    <HStack alignItems="center">
                      <Typography fontFamily="monospace">{flag}</Typography>
                      <IconButton
                        onClick={() => new Clipboard().writeText(flag)}
                        sx={{ color: "gray" }}
                      >
                        <ContentCopy sx={{ fontSize: 15 }} />
                      </IconButton>
                    </HStack>
                    <small>
                      Evaluated to: {JSON.stringify(flags[flag])} by{" "}
                      <strong>overrides</strong>
                    </small>
                  </Stack>
                  <Stack direction={"row"}>
                    {flags[flag] != null ? (
                      <Button onClick={() => {}} size="small">
                        Clear
                      </Button>
                    ) : (
                      <small>Override</small>
                    )}
                    <Switch checked={flags[flag]} onChange={() => {}} />
                  </Stack>
                </HStack>
              </Paper>
            );
          })}
      </Stack>
    </Stack>
  );
}
