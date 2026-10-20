interface TelegramButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  setParams(params: { text: string; color: string; text_color: string; is_visible: boolean }): void;
}
interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: { user?: { id: number; first_name?: string; photo_url?: string } };
  colorScheme?: 'dark' | 'light';
  themeParams?: { bg_color?: string };
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(event: string, callback: () => void): void;
  BackButton?: TelegramButton;
  MainButton?: TelegramButton;
  showConfirm?(message: string, callback: (confirmed: boolean) => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'success' | 'warning' | 'error'): void;
  };
}
interface Window { Telegram?: { WebApp?: TelegramWebApp } }
