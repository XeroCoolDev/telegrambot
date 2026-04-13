/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface TelegramWebApp {
  initData: string;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void };
  HapticFeedback: {
    selectionChanged(): void;
    impactOccurred(style: string): void;
    notificationOccurred(type: string): void;
  };
  openLink(url: string): void;
  showAlert(msg: string, cb?: () => void): void;
  showConfirm(msg: string, cb: (ok: boolean) => void): void;
}

declare global {
  interface Window {
    Telegram: { WebApp: TelegramWebApp };
  }
}
