import { Navigator } from "./Navigator";

import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import {
  BottomNavigation,
  BottomNavigationAction,
  CircularProgress,
  Paper,
} from "@mui/material";
import React, { Component, ReactNode, useState } from "react";
import NavigationIcon from "@mui/icons-material/Navigation";
import DeveloperModeIcon from "@mui/icons-material/DeveloperMode";
import BugReportIcon from "@mui/icons-material/BugReport";
import { Network } from "./Network";
import { Errors, NotPropellerWebsiteError, PropellerError } from "./errors";
import { QueryClient, QueryClientProvider } from "react-query";
import { useActiveTab } from "./storage";
import { Flag, FormatPaint, Refresh } from "@mui/icons-material";
import FeatureFlags from "./FeatureFlags";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const client = new QueryClient();

export function App() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <QueryClientProvider client={client}>
        <RootErrorBoundary>
          <AppInner />
        </RootErrorBoundary>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function AppInner() {
  const [view, setView] = useActiveTab();
  if (view.isLoading) return <CircularProgress />;

  const Router = [Navigator, Network, FeatureFlags][view?.data ?? 0];
  return (
    <>
      <Box sx={{ minWidth: 650, padding: 1, marginBottom: 5, minHeight: 250 }}>
        <Router />
      </Box>
      <Paper
        sx={{ position: "fixed", bottom: 0, left: 0, right: 0 }}
        elevation={3}
      >
        <BottomNavigation
          showLabels
          value={view?.data ?? 0}
          onChange={(event, newValue) => {
            if (newValue === 3) return;
            if (newValue === 4) {
              chrome.tabs.reload();
            } else setView(newValue);
          }}
        >
          <BottomNavigationAction
            label="Navigation"
            icon={<NavigationIcon />}
          />
          <BottomNavigationAction
            label="Local Injection"
            icon={<DeveloperModeIcon />}
          />
          <BottomNavigationAction label="Feature Flags" icon={<Flag />} />
          <BottomNavigationAction
            label="MUI Theme (wip)"
            icon={<FormatPaint />}
          />
          <BottomNavigationAction label="Refresh" icon={<Refresh />} />
        </BottomNavigation>
      </Paper>
    </>
  );
}

class RootErrorBoundary extends Component<{ children: ReactNode }> {
  state: { caughtError: Errors | null } = { caughtError: null };
  static getDerivedStateFromError(error: Error) {
    if (error instanceof PropellerError) {
      return { caughtError: error };
    }

    return { caughtError: null };
  }

  render() {
    if (this.state.caughtError == null) return this.props.children;

    if (this.state.caughtError instanceof NotPropellerWebsiteError) {
      return (
        <Box sx={{ minWidth: 500 }}>
          <h3>{this.state.caughtError.message}</h3>
        </Box>
      );
    }
  }
}
