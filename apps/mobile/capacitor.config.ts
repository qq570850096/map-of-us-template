import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mapofus.mobile",
  appName: "Map of Us",
  webDir: "../web/out",
  server: {
    androidScheme: "https",
  },
};

export default config;
