import { useEffect, useRef, useState } from "react";
import {
  Badge,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Stack,
  styled,
  TextField,
  Typography,
} from "@mui/material";
import {
  initializeClient,
  getFeatureFlagValue,
} from "@propelleraero/launch-darkly-client";
import { HStack } from "./common/HStack";
import {
  Cancel,
  Check,
  CheckCircle,
  Clear,
  ContentCopy,
} from "@mui/icons-material";
import { badgeClasses } from "@mui/material/Badge";

// @ts-expect-error
const envKey = import.meta.env.VITE_LD_ENVKEY || "";

const FlagBadge = styled(Badge)`
  & .${badgeClasses.badge} {
    top: 10px;
    right: -2px;
  }
`;

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

  const ComplexSwitch = ({ value }) => {
    const anchor = useRef(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const handleOpen = () => {
      setIsMenuOpen(true);
    };

    const handleClose = () => {
      setIsMenuOpen(false);
    };

    return (
      <>
        <IconButton ref={anchor} onClick={handleOpen}>
          <Check fontSize="small" />
          <FlagBadge color="primary" variant="dot" overlap="circular" />
        </IconButton>
        <Menu
          id="basic-menu"
          anchorEl={anchor.current}
          open={isMenuOpen}
          onClose={handleClose}
          MenuListProps={{
            "aria-labelledby": "basic-button",
          }}
        >
          <MenuItem onClick={handleClose}>
            <ListItemIcon>
              <CheckCircle fontSize="small" />
            </ListItemIcon>
            Override ON
          </MenuItem>
          <MenuItem onClick={handleClose}>
            {" "}
            <ListItemIcon>
              <Cancel fontSize="small" />
            </ListItemIcon>
            Override OFF
          </MenuItem>
          <MenuItem onClick={handleClose}>
            <ListItemIcon>
              <Clear fontSize="small" />
            </ListItemIcon>
            Clear override
          </MenuItem>
        </Menu>
      </>
    );
  };

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
              <Paper sx={{ padding: 1 }} key={flag}>
                <HStack justifyContent="space-between" alignItems="center">
                  <HStack alignItems="center">
                    <Typography fontFamily="monospace">{flag}</Typography>
                    <IconButton
                      onClick={() => new Clipboard().writeText(flag)}
                      sx={{ color: "gray" }}
                    >
                      <ContentCopy sx={{ fontSize: 15 }} />
                    </IconButton>
                  </HStack>
                  <Stack direction={"row"}>
                    <ComplexSwitch value={flags[flag]} />
                  </Stack>
                </HStack>
              </Paper>
            );
          })}
      </Stack>
    </Stack>
  );
}
