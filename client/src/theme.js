export const colorTokens = {
  grey: {
    0: "#FFFFFF",
    10: "#F6F6F6",
    50: "#F0F0F0",
    100: "#E0E0E0",
    200: "#C2C2C2",
    300: "#A3A3A3",
    400: "#858585",
    500: "#666666",
    600: "#4D4D4D",
    700: "#333333",
    800: "#1A1A1A",
    900: "#0A0A0A",
    1000: "#000000",
  },
  primary: {
    50: "#83d18d",
    100: "#7ece89",
    200: "#77cb83",
    300: "#70c77d",
    400: "#68c377",
    500: "#60bf70",
    600: "#5bb76c",
    700: "#56af68",
    800: "#51a763",
    900: "#4da05e",
  },
};

export const themeSettings = (mode) => ({
  palette: {
    mode,
    primary: {
      dark: colorTokens.primary[700],
      main: colorTokens.primary[500],
      light: colorTokens.primary[100], // Changed from 50 for better contrast
    },
    neutral: {
      dark: colorTokens.grey[700],
      main: colorTokens.grey[500],
      light: colorTokens.grey[100], // Changed from 50 for better readability
    },
    background: {
      default: mode === "light" ? colorTokens.grey[0] : colorTokens.grey[900],
      alt: mode === "light" ? colorTokens.grey[50] : colorTokens.grey[800],
    },
    text: {
      primary: mode === "light" ? colorTokens.grey[900] : colorTokens.grey[100],
      secondary: mode === "light" ? colorTokens.grey[700] : colorTokens.grey[300], // Added for secondary text
    },
  },
  typography: {
    fontFamily: "'Roboto', 'Arial', sans-serif", // Standard Material-UI font
    fontSize: 14,
    h1: { fontSize: "2.125rem", fontWeight: 700 },
    h2: { fontSize: "1.75rem", fontWeight: 600 },
    h3: { fontSize: "1.5rem", fontWeight: 500 },
    body1: { fontSize: "1rem" },
    body2: { fontSize: "0.875rem" },
  },
});
