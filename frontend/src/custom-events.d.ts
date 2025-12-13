export {};

declare global {
  interface WindowEventMap {
    userChanged: CustomEvent<unknown>;
  }
}
