import { StockMovement } from "./types";

export function computeBalance(movements: StockMovement[]): number {
  return movements.reduce((sum, m) => sum + Number(m.change), 0);
}
