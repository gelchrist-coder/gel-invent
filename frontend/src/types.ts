export type MeasurementType = "count" | "weight" | "volume" | "length";

export type ProductVariant = {
  id: number;
  label: string;
  attributes_json: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ProductUnitConversion = {
  id: number;
  unit_name: string;
  base_quantity: number;
  is_sale_unit: boolean;
  is_purchase_unit: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type NewProductVariant = {
  label: string;
  attributes_json?: Record<string, unknown>;
  is_active?: boolean;
  sort_order?: number;
};

export type NewProductUnitConversion = {
  unit_name: string;
  base_quantity: number;
  is_sale_unit?: boolean;
  is_purchase_unit?: boolean;
  sort_order?: number;
};

export type Product = {
  id: number;
  sku: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  unit: string;
  measurement_type?: MeasurementType | null;
  allows_fractional_sales?: boolean | null;
  quantity_step?: number | null;
  variant_group?: string | null;
  variant_label?: string | null;
  brand?: string | null;
  size?: string | null;
  color?: string | null;
  shade?: string | null;
  pack_size?: number | null;
  category?: string | null;
  supplier?: string | null;
  expiry_date?: string | null;
  cost_price?: number | null;
  pack_cost_price?: number | null;
  selling_price?: number | null;
  pack_selling_price?: number | null;
  image?: string | null;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  current_stock?: number | null;
  reserved_stock?: number | null;
  active_batch_count?: number | null;
  next_batch_expiry_date?: string | null;
  variants?: ProductVariant[];
  unit_conversions?: ProductUnitConversion[];
};

export type StockMovement = {
  id: number;
  product_id: number;
  variant_id?: number | null;
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
  barcode?: string | null;
  name: string;
  description?: string | null;
  unit?: string;
  measurement_type?: MeasurementType | null;
  allows_fractional_sales?: boolean | null;
  quantity_step?: number | null;
  variant_group?: string | null;
  variant_label?: string | null;
  brand?: string | null;
  size?: string | null;
  color?: string | null;
  shade?: string | null;
  pack_size?: number | null;
  category?: string | null;
  supplier?: string | null;
  expiry_date?: string | null;
  cost_price?: number | null;
  pack_cost_price?: number | null;
  selling_price?: number | null;
  pack_selling_price?: number | null;
  image?: string | null;
  initial_stock?: number;
  variants?: NewProductVariant[];
  unit_conversions?: NewProductUnitConversion[];
};

export type ProductUpdate = Partial<Omit<Product, "variants" | "unit_conversions">> & {
  variants?: NewProductVariant[];
  unit_conversions?: NewProductUnitConversion[];
};

export type NewMovement = {
  change: number;
  reason?: string;
  variant_id?: number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
  unit_cost_price?: number | null;
  unit_selling_price?: number | null;
};

export type Sale = {
  id: number;
  client_sale_id?: string | null;
  product_id: number;
  variant_id?: number | null;
  quantity: number;
  sale_unit_type?: string;
  pack_quantity?: number | null;
  unit_price: number;
  total_price: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  payment_method: string;
  amount_paid?: number | null;
  partial_payment_method?: string | null;
  notes?: string | null;
  supplied_quantity?: number | null;
  supplied_at?: string | null;
  created_at: string;
  created_by_name?: string | null;
  deducted_batches?: Array<{
    batch_number?: string | null;
    expiry_date?: string | null;
    quantity: number;
  }> | null;
  // Per-pickup collection history for "collect later" sales (proof of hand-over).
  supplies?: SaleSupply[] | null;
};

export type SaleSupply = {
  id: number;
  sale_id: number;
  quantity: number;
  collected_by_name?: string | null;
  notes?: string | null;
  created_at: string;
};

export type SaleBatchOption = {
  batch_number: string;
  expiry_date?: string | null;
  available_quantity: number;
  first_seen?: string | null;
};

export type NewSale = {
  client_sale_id?: string;
  product_id: number;
  variant_id?: number | null;
  quantity: number;
  sale_unit_type?: string;
  pack_quantity?: number;
  preferred_batch_number?: string | null;
  unit_price: number;
  total_price: number;
  customer_name?: string | null;
  customer_phone?: string | null;
  payment_method?: string;
  notes?: string | null;
  amount_paid?: number;
  partial_payment_method?: string;
  // When true the customer paid in full but is collecting later — the reserved
  // portion stays physically in the store and is only deducted at collection.
  not_supplied?: boolean;
  // For collect-later sales: how much the customer takes at the counter now.
  // The rest (quantity - collected_quantity) stays reserved.
  collected_quantity?: number;
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
  order_number?: string | null;
  supplier_id?: number | null;
  supplier_name: string;
  product_id?: number | null;
  variant_id?: number | null;
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
  variant_id?: number | null;
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

export type NewPurchaseOrderItem = {
  product_id: number;
  variant_id?: number | null;
  quantity: number;
  unit_cost_price: number;
  unit_selling_price?: number | null;
  expiry_date?: string | null;
};

export type NewPurchaseOrder = {
  supplier_id?: number | null;
  supplier_name?: string | null;
  invoice_number?: string | null;
  amount_paid?: number | null;
  payment_method?: string | null;
  purchase_date?: string | null;
  due_date?: string | null;
  notes?: string | null;
  items: NewPurchaseOrderItem[];
};

export type PurchaseOrder = {
  order_number: string;
  supplier_id?: number | null;
  supplier_name: string;
  invoice_number?: string | null;
  line_count: number;
  total_cost: number;
  amount_paid: number;
  amount_due: number;
  payment_status: "unpaid" | "partial" | "paid";
  payment_method?: string | null;
  purchase_date?: string | null;
  due_date?: string | null;
  notes?: string | null;
  created_at: string;
  created_by_name?: string | null;
  items: Purchase[];
};

export type SupplierPayment = {
  id: number;
  supplier_id?: number | null;
  supplier_name: string;
  purchase_id?: number | null;
  order_number?: string | null;
  purchase_invoice_number?: string | null;
  product_name?: string | null;
  amount: number;
  payment_method: string;
  payment_date?: string | null;
  notes?: string | null;
  created_at: string;
  created_by_name?: string | null;
};

export type PurchaseReturn = {
  id: number;
  supplier_id?: number | null;
  supplier_name: string;
  purchase_id: number;
  product_id?: number | null;
  order_number?: string | null;
  purchase_invoice_number?: string | null;
  product_name?: string | null;
  quantity_returned: number;
  unit_cost_price: number;
  total_cost_returned: number;
  return_date?: string | null;
  reason?: string | null;
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
  purchase_id?: number | null;
  order_number?: string | null;
  amount: number;
  payment_method: string;
  payment_date?: string | null;
  notes?: string | null;
};

export type NewPurchaseReturn = {
  purchase_id: number;
  quantity_returned: number;
  return_date?: string | null;
  reason?: string | null;
  notes?: string | null;
};
