export type Product = {
  id: number;
  sku: string;
  name: string;
  description?: string | null;
  unit: string;
  pack_size?: number | null;
  category?: string | null;
  expiry_date?: string | null;
  cost_price?: number | null;
  pack_cost_price?: number | null;
  selling_price?: number | null;
  pack_selling_price?: number | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  current_stock?: number | null;
};

export type StockMovement = {
  id: number;
  product_id: number;
  change: number;
  reason: string;
  batch_number?: string | null;
  expiry_date?: string | null;
  unit_cost_price?: number | null;
  unit_selling_price?: number | null;
  created_at: string;
};

export type NewProduct = {
  sku: string;
  name: string;
  description?: string | null;
  unit?: string;
  pack_size?: number | null;
  category?: string | null;
  expiry_date?: string | null;
  cost_price?: number | null;
  pack_cost_price?: number | null;
  selling_price?: number | null;
  pack_selling_price?: number | null;
  initial_stock?: number;
};

export type NewMovement = {
  change: number;
  reason?: string;
  batch_number?: string | null;
  expiry_date?: string | null;
  unit_cost_price?: number | null;
  unit_selling_price?: number | null;
};

export type Sale = {
  id: number;
  product_id: number;
  quantity: number;
  sale_unit_type?: "piece" | "pack";
  pack_quantity?: number | null;
  unit_price: number;
  total_price: number;
  customer_name?: string | null;
  payment_method: string;
  notes?: string | null;
  created_at: string;
  created_by_name?: string | null;
  deducted_batches?: Array<{
    batch_number?: string | null;
    expiry_date?: string | null;
    quantity: number;
  }> | null;
};

export type NewSale = {
  client_sale_id?: string;
  product_id: number;
  quantity: number;
  sale_unit_type?: "piece" | "pack";
  pack_quantity?: number;
  unit_price: number;
  total_price: number;
  customer_name?: string | null;
  payment_method?: string;
  notes?: string | null;
  amount_paid?: number;
  partial_payment_method?: string;
};

export type Branch = {
  id: number;
  owner_user_id: number;
  name: string;
  is_active: boolean;
};
