/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#123B5D",
          deep: "#0E2E4A",
          soft: "#E4EDF4",
        },
        healthcare: {
          DEFAULT: "#1769AA",
          dark: "#11527F",
          soft: "#EAF4FB",
          faint: "#F3F8FC",
        },
        teal: {
          DEFAULT: "#168C8C",
          dark: "#0F6E6E",
          soft: "#E8F7F5",
        },
        success: {
          DEFAULT: "#2E8B68",
          soft: "#EAF7F1",
        },
        warning: {
          DEFAULT: "#C58A22",
          soft: "#FFF7E6",
        },
        danger: {
          DEFAULT: "#C94C4C",
          soft: "#FDEEEE",
        },
        background: "#F7F9FB",
        card: "#FFFFFF",
        ink: {
          DEFAULT: "#163042",
          secondary: "#617486",
          faint: "#8CA0B1",
        },
        border: "#DCE5EA",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      borderRadius: {
        card: "14px",
        control: "10px",
      },
      boxShadow: {
        subtle: "0 1px 2px rgba(18,59,93,0.06), 0 4px 14px rgba(18,59,93,0.06)",
        card: "0 1px 3px rgba(18,59,93,0.08), 0 8px 24px rgba(18,59,93,0.07)",
      },
      maxWidth: {
        shell: "1200px",
      },
    },
  },
  plugins: [],
};
