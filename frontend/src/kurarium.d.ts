export {};

declare global {
  interface Window {
    kurarium?: {
      getInfo: () => Promise<{
        version: string;
        portable: boolean;
        autoStart: boolean;
        packaged: boolean;
      }>;
      setAutoStart: (enabled: boolean) => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
      openInBrowser: () => Promise<void>;
      restart: () => Promise<void>;
      quit: () => Promise<void>;
    };
  }
}
