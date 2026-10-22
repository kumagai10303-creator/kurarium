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
      pickFolder: (defaultPath?: string) => Promise<string[]>;
      restart: () => Promise<void>;
      quit: () => Promise<void>;
    };
  }
}
