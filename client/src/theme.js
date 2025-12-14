export const colorTokens = {
  // Deep Space Premium Theme
  grey: {
    0: "#FFFFFF",
    10: "#F9FAFB", // Premium Light Gray
    50: "#F3F4F6",
    100: "#E5E7EB",
    200: "#D1D5DB",
    300: "#9CA3AF",
    400: "#6B7280",
    500: "#4B5563",
    600: "#374151",
    700: "#1F2937",
    800: "#111827", // Rich Dark Gray
    900: "#09090b", // Deep Black/Charcoal (Not pure black)
    1000: "#000000",
  },
  // Neon Accents (Cyberpunk/Quantum)
  primary: {
    50: "#f0f9ff",
    100: "#e0f2fe",
    200: "#bae6fd",
    300: "#7dd3fc",
    400: "#38bdf8",
    500: "#0ea5e9",
    600: "#0284c7",
    700: "#0369a1",
    800: "#075985",
    900: "#3b82f6", // Pro Blue
  },
  secondary: {
    main: "#8b5cf6", // Electric Violet
    light: "#a78bfa",
    dark: "#7c3aed",
  },
  glass: {
    light: "rgba(255, 255, 255, 0.7)",
    medium: "rgba(255, 255, 255, 0.5)",
    dark: "rgba(9, 9, 11, 0.7)", // Matches grey[900]
  }
};

export const themeSettings = (mode) => ({
  palette: {
    mode,
    ...(mode === "dark"
      ? {
        // Premium Dark Mode
        primary: {
          dark: colorTokens.primary[200],
          main: colorTokens.primary[400], // Brighter blue
          light: colorTokens.primary[800],
        },
        secondary: {
          main: colorTokens.secondary.main,
          light: colorTokens.secondary.light,
          dark: colorTokens.secondary.dark,
        },
        neutral: {
          dark: colorTokens.grey[100],
          main: colorTokens.grey[200],
          mediumMain: colorTokens.grey[300],
          medium: colorTokens.grey[400],
          light: colorTokens.grey[700],
        },
        background: {
          default: colorTokens.grey[900], // Deep Charcoal/Black
          paper: colorTokens.grey[800], // Slightly lighter for cards
          alt: colorTokens.grey[800],
          glass: colorTokens.glass.dark,
        },
        text: {
          primary: "#F3F4F6", // High contrast white
          secondary: "#9CA3AF",
        }
      }
      : {
        // Premium Light Mode
        primary: {
          dark: colorTokens.primary[700],
          main: colorTokens.primary[900], // Professional Royal Blue
          light: colorTokens.primary[50],
        },
        secondary: {
          main: colorTokens.secondary.dark,
          light: colorTokens.secondary.main,
          dark: colorTokens.secondary.dark,
        },
        neutral: {
          dark: colorTokens.grey[800],
          main: colorTokens.grey[600],
          mediumMain: colorTokens.grey[500],
          medium: colorTokens.grey[400],
          light: colorTokens.grey[100],
        },
        background: {
          default: "#FFFFFF", // Pure White
          paper: "#F9FAFB", // Very light gray for cards
          alt: "#F3F4F6",
          glass: "rgba(255, 255, 255, 0.8)",
        },
        text: {
          primary: "#111827", // Near black
          secondary: "#4B5563",
        }
      }),
  },
  typography: {
    fontFamily: ["Outfit", "Inter", "sans-serif"].join(","),
    fontSize: 12,
    h1: {
      fontFamily: ["Outfit", "Inter", "sans-serif"].join(","),
      fontSize: 40,
      fontWeight: 800,
    },
    h2: {
      fontFamily: ["Outfit", "Inter", "sans-serif"].join(","),
      fontSize: 32,
      fontWeight: 700,
    },
    h3: {
      fontFamily: ["Outfit", "Inter", "sans-serif"].join(","),
      fontSize: 24,
      fontWeight: 700,
    },
    h4: {
      fontFamily: ["Outfit", "Inter", "sans-serif"].join(","),
      fontSize: 20,
      fontWeight: 600,
    },
    h5: {
      fontFamily: ["Outfit", "Inter", "sans-serif"].join(","),
      fontSize: 16,
      fontWeight: 600,
    },
    h6: {
      fontFamily: ["Outfit", "Inter", "sans-serif"].join(","),
      fontSize: 14,
      fontWeight: 600,
    },
    body1: { fontSize: "0.95rem" },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          borderRadius: "10px", // More rounded
          fontWeight: 600,
          boxShadow: "none",
          transition: "all 0.3s ease",
          "&:hover": {
            transform: "translateY(-1px)",
            boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.1)",
          },
        },
        containedSecondary: {
          background: "linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)", // Purple Gradient
          color: "#ffffff",
          "&:hover": {
            background: "linear-gradient(135deg, #7c3aed 0%, #c026d3 100%)",
            boxShadow: "0px 0px 20px rgba(139, 92, 246, 0.5)",
          }
        },
        containedPrimary: {
          background: "linear-gradient(135deg, #0ea5e9 0%, #3b82f6 100%)", // Blue Gradient
          color: "#ffffff",
          "&:hover": {
            background: "linear-gradient(135deg, #0284c7 0%, #2563eb 100%)",
            boxShadow: "0px 0px 20px rgba(14, 165, 233, 0.5)",
          }
        }
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: "16px",
          backdropFilter: "blur(12px)",
          background: mode === 'dark'
            ? "linear-gradient(145deg, rgba(31, 41, 55, 0.6) 0%, rgba(17, 24, 39, 0.8) 100%)"
            : "#FFFFFF",
          border: `1px solid ${mode === 'dark' ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
          boxShadow: mode === 'dark' ? "0 4px 30px rgba(0, 0, 0, 0.4)" : "0 4px 20px rgba(0, 0, 0, 0.05)",
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none", // Remove Material UI default gradient
        }
      }
    }
  },
});
