export {};

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface WindowEventMap {
    userChanged: CustomEvent<unknown>;
    businessInfoChanged: CustomEvent<unknown>;
    offlineOutboxChanged: Event;
    productsUpdated: Event;
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}
