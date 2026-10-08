import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Must match the Bundle ID you register in App Store Connect. Change it before your first upload.
  appId: "com.hareshsingh.velocity",
  appName: "Velocity",
  // The static site produced by `next build`.
  webDir: "out",
  ios: {
    // The app draws its own safe-area padding, so let it run edge to edge.
    contentInset: "never",
    backgroundColor: "#f5f4f0",
  },
  plugins: {
    LocalNotifications: {
      iconColor: "#e8590c",
    },
  },
};

export default config;
