export const HEADER_INJECTION_CONFIG = {
  visualiserDesktop: {
    name: "Visualiser Desktop",
    headerName: "X-Visualiser-Source",
    headerValue: "https://localhost:3000",
  },
  visualiserMobile: {
    name: "Visualiser Mobile",
    headerName: "X-VisualiserMobile-Source",
    headerValue: "https://localhost:3001",
  },
};

export type CustomHeaderInjectionConfig = Record<
  string,
  {
    id: number;
    name: string;
    headerName: string;
    headerValue: string;
    enabled: boolean;
  }
>;
