import { useEffect, useState } from "react";
import { Checkbox, Paper, Stack, Typography } from "@mui/material";
import {
  initializeClient,
  getFeatureFlagValue,
} from "@propelleraero/launch-darkly-client";

// @ts-expect-error
const envKey = import.meta.env.VITE_LD_ENVKEY || "";

export default function FeatureFlags() {
  const [flags, setFlags] = useState<Record<string, boolean>>({});

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
      <Stack
        spacing={1}
        sx={{ maxHeight: 300, overflowY: "auto", marginBottom: 4 }}
      >
        {Object.keys(flags).map((flag) => {
          return (
            <Paper sx={{ padding: 1 }} key={flag}>
              <Stack direction="row" alignItems="center" spacing={1}>
                {flags[flag] && <Checkbox color="success" />}
                <Typography fontSize={14} fontFamily="monospace" noWrap>
                  {flag}
                </Typography>
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
