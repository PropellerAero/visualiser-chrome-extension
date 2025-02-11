import { useEffect, useState } from "react";
import {
  clearFeatureFlagOverride,
  getThenListenForFlagEvals,
} from "../../common/storage";
import {
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  Switch,
  TextField,
} from "@mui/material";
import { useFeatureFlagOverrides } from "./storage";
import { CheckBox } from "@mui/icons-material";

export default function FeatureFlags() {
  const [evals, setEvals] = useState({} as Record<string, boolean>);
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useFeatureFlagOverrides();
  useEffect(() => {
    return getThenListenForFlagEvals(setEvals);
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
        {Object.keys(evals)
          .filter((value) => (search ? value.includes(search) : true))
          .map((flag) => {
            return (
              <Paper sx={{ padding: 2 }} key={flag}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Stack>
                    <strong>{flag}</strong>
                    <small>Evaluated to: {JSON.stringify(evals[flag])}</small>
                  </Stack>
                  <Stack>
                    {overrides.data[flag] != null ? (
                      <Button
                        onClick={async () => {
                          await clearFeatureFlagOverride(flag);
                          return overrides.refetch();
                        }}
                        size="small"
                      >
                        Clear
                      </Button>
                    ) : (
                      <small>Override</small>
                    )}
                    <Switch
                      disabled={!overrides.data}
                      checked={overrides.data[flag] ?? evals[flag]}
                      onChange={(ev) =>
                        setOverrides({
                          [flag]: ev.target.checked,
                        })
                      }
                    />
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
      </Stack>
    </Stack>
  );
}
