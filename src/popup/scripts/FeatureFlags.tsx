import { useEffect, useState } from "react";
import {
  clearFeatureFlagOverride,
  getThenListenForFlagEvals,
} from "../../common/storage";
import {
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  Icon,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useFeatureFlagOverrides } from "./storage";
import { CheckCircle, CancelOutlined } from "@mui/icons-material";

export default function FeatureFlags() {
  const [flags, setFlags] = useState<Record<string, boolean>>({
    "vis-special-foo-project": true,
    "vis-that-boo-thing": false,
    "vis-super-long-lorem-ipsum-style-key-for-some-reason-or-another-example-key":
      true,
    x1: false,
  });

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
