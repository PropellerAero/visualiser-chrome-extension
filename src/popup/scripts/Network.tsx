import {
  Button,
  CircularProgress,
  Paper,
  Stack,
  Switch,
  TextField,
} from "@mui/material";

import {
  useCustomInjectionRules,
  useInjectionRules,
  useInjectionToken,
} from "./storage";
import { HEADER_INJECTION_CONFIG } from "../../common/headerInjection";
import { Delete } from "@mui/icons-material";

export function Network() {
  const [token, setToken] = useInjectionToken();
  const [rules, setRules] = useInjectionRules();
  const [customRules, setCustomRules] = useCustomInjectionRules();

  if (token.isLoading || rules.isLoading) return <CircularProgress />;
  return (
    <Stack
      spacing={1}
      sx={{ maxHeight: 300, overflowY: "auto", marginBottom: 4 }}
    >
      <Paper sx={{ padding: 2 }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          Enable Local Injection
          <Switch
            disabled={!token.data}
            checked={rules.data?.enabled}
            onChange={(ev) => setRules({ enabled: ev.target.checked })}
          />
        </Stack>
        <small></small>
        <Stack direction="row">
          <TextField
            placeholder="Get from 1Password"
            label="Injection Token"
            fullWidth
            size="small"
            type="password"
            value={token.data}
            onChange={(e) => setToken(e.target.value)}
          />
          {!token.data && (
            <Button
              size="small"
              href="https://start.1password.com/open/i?a=ZEHCAFMOHNBRHAGCK67WUZVV6M&v=jxhqu5oepowdedovlesugkslye&i=u6hg2mvyqzyjbnqh5qojkf6sfi&h=propelleraero.1password.com"
              target="_blank"
              sx={{ minWidth: 140 }}
            >
              Open 1Password
            </Button>
          )}
        </Stack>
      </Paper>
      {Object.keys(HEADER_INJECTION_CONFIG).map((key) => {
        const v =
          HEADER_INJECTION_CONFIG[key as keyof typeof HEADER_INJECTION_CONFIG];

        return (
          <Paper
            key={key}
            sx={{
              padding: 2,
              opacity: token.data ? 1 : 0.5,
              pointerEvents: token.data ? "initial" : "none",
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              {v.name}
              <Switch
                size="small"
                checked={
                  rules.data?.[key as keyof typeof HEADER_INJECTION_CONFIG] ??
                  false
                }
                onChange={(ev) => setRules({ [key]: ev.target.checked })}
              />
            </Stack>
            <small>
              {v.headerName} : {v.headerValue}
            </small>
          </Paper>
        );
      })}
      {customRules.data != null &&
        Object.keys(customRules.data).map((key) => {
          if (customRules.data == null) return null;

          const v = customRules.data[key];
          return (
            <Paper
              key={key}
              sx={{
                padding: 2,
                opacity: token.data ? 1 : 0.5,
                pointerEvents: token.data ? "initial" : "none",
              }}
            >
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Header name"
                    value={v.headerName}
                    size="small"
                    onChange={(ev) =>
                      setCustomRules({
                        ...v,
                        headerName: ev.target.value,
                      })
                    }
                  />
                  <TextField
                    label="Header value"
                    onChange={(ev) =>
                      setCustomRules({
                        ...v,
                        headerValue: ev.target.value,
                      })
                    }
                    value={v.headerValue}
                    size="small"
                  />
                </Stack>
                <Stack direction="row" alignItems="center">
                  <Switch
                    checked={v.enabled}
                    size="small"
                    disabled={!v.headerName || !v.headerValue}
                    onChange={(ev) =>
                      setCustomRules({
                        ...v,
                        enabled: ev.target.checked,
                      })
                    }
                  />
                  <Button
                    onClick={() => setCustomRules({ id: v.id, mode: "delete" })}
                    size="small"
                  >
                    <Delete />
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          );
        })}

      <Button
        onClick={() => {
          setCustomRules({
            id: Math.floor(Math.random() * 10000),
            name: "",
            headerName: "",
            headerValue: "",
            enabled: false,
          });
        }}
      >
        Add Custom
      </Button>
    </Stack>
  );
}
