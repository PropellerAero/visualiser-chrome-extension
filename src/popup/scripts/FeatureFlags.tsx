import { useEffect, useRef, useState } from "react";
import { Paper, Stack, Typography } from "@mui/material";
import { CheckCircle, CancelOutlined } from "@mui/icons-material";
import { initialize, LDClient } from "launchdarkly-js-client-sdk";

// @ts-expect-error
const envKey = import.meta.env.VITE_LD_ENVKEY || "";

export default function FeatureFlags() {
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  const client = useRef<LDClient>();

  useEffect(() => {
    if (!envKey) {
      throw new Error("Missing VITE_LD_ENVKEY in .env");
    }

    client.current = initialize(envKey, {
      kind: "user",
      key: "00000000000000000000000000000000000000000000",
      name: "foo",
    });

    client.current.on("ready", () => {
      const newFlags = client.current?.allFlags() as Record<string, boolean>;
      console.log(client.current?.allFlags());
      setFlags(newFlags);
    });

    return () => {
      client.current?.close();
    };
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
                {flags[flag] ? (
                  <CheckCircle color="success" />
                ) : (
                  <CancelOutlined color="disabled" />
                )}
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
