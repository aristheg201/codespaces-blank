export {};

declare global {
  interface Window {
    bestiary: {
      bootstrap(): Promise<any>;
      saveSettings(settings: unknown): Promise<any>;
      start(): Promise<any>;
      repair(): Promise<any>;
      openExternal(url: string): Promise<boolean>;
      minimize(): void;
      maximize(): void;
      close(): void;
      on(channel: string, listener: (payload: any) => void): () => void;
    };
  }
}
