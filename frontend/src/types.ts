export type Product = {
  id: number;
  sku: string;
  name: string;
  description?: string | null;
  unit: string;
  pack_size?: number | null;
  category?: string | null;
  supplier?: string | null;
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
  supplier?: string | null;
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

export type Supplier = {
  id: number;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  is_active: boolean;
  total_purchased?: number | null;
  total_paid?: number | null;
  outstanding_balance?: number | null;
  unpaid_purchases_count?: number | null;
  last_payment_date?: string | null;
  created_at: string;
  updated_at: string;
};

export type NewSupplier = {
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type SupplierUpdate = {
  name?: string | null;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type Purchase = {
  id: number;
  supplier_id?: number | null;
  supplier_name: string;
  product_id?: number | null;
  product_name: string;
  product_sku: string;
  stock_movement_id?: number | null;
  invoice_number?: string | null;
  quantity: number;
  unit_cost_price: number;
  unit_selling_price?: number | null;
  total_cost: number;
  payment_status: "unpaid" | "partial" | "paid";
  amount_paid: number;
  amount_due: number;
  payment_method?: string | null;
  purchase_date?: string | null;
  due_date?: string | null;
  notes?: string | null;
  created_at: string;
  created_by_name?: string | null;
};

export type NewPurchase = {
  product_id: number;
  supplier_id?: number | null;
  supplier_name?: string | null;
  invoice_number?: string | null;
  quantity: number;
  unit_cost_price: number;
  unit_selling_price?: number | null;
  amount_paid?: number | null;
  payment_method?: string | null;
  purchase_date?: string | null;
  due_date?: string | null;
  expiry_date?: string | null;
  notes?: string | null;
};

export type SupplierPayment = {
  id: number;
  supplier_id?: number | null;
  supplier_name: string;
  purchase_id?: number | null;
  purchase_invoice_number?: string | null;
  product_name?: string | null;
  amount: number;
  payment_method: string;
  payment_date?: string | null;
  notes?: string | null;
  created_at: string;
  created_by_name?: string | null;
};

export type SupplierDetail = {
  supplier: Supplier;
  purchases: Purchase[];
  payments: SupplierPayment[];
};

export type NewSupplierPayment = {
  purchase_id: number;
  amount: number;
  payment_method: string;
  payment_date?: string | null;
  notes?: string | null;
};
