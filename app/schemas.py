from datetime import datetime, date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProductBase(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    barcode: str | None = Field(default=None, max_length=128)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    unit: str = Field(default="unit", min_length=1, max_length=32)
    measurement_type: Literal["count", "weight", "volume", "length"] = "count"
    allows_fractional_sales: bool = False
    quantity_step: Decimal = Field(default=Decimal("1"), gt=0, decimal_places=2)
    variant_group: str | None = Field(default=None, max_length=120)
    variant_label: str | None = Field(default=None, max_length=120)
    brand: str | None = Field(default=None, max_length=100)
    size: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, max_length=64)
    shade: str | None = Field(default=None, max_length=64)
    pack_size: int | None = Field(default=None)
    category: str | None = Field(default=None, max_length=100)
    supplier: str | None = Field(default=None, max_length=255)
    expiry_date: date | None = Field(default=None)
    cost_price: Decimal | None = Field(default=None, decimal_places=2)
    pack_cost_price: Decimal | None = Field(default=None, decimal_places=2)
    selling_price: Decimal | None = Field(default=None, decimal_places=2)
    pack_selling_price: Decimal | None = Field(default=None, decimal_places=2)


class ProductCreate(ProductBase):
    initial_stock: Decimal | None = Field(default=None)
    initial_location: str | None = Field(default="Main Store", max_length=100)


class ProductRead(ProductBase):
    id: int
    created_at: datetime
    updated_at: datetime
    created_by_name: str | None = None
    current_stock: Decimal = Decimal(0)
    active_batch_count: int = 0
    next_batch_expiry_date: date | None = None

    model_config = ConfigDict(from_attributes=True)


class SupplierBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    contact_person: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=1000)


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    contact_person: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=1000)


class SupplierRead(SupplierBase):
    id: int
    is_active: bool
    total_purchased: Decimal = Decimal(0)
    total_paid: Decimal = Decimal(0)
    outstanding_balance: Decimal = Decimal(0)
    unpaid_purchases_count: int = 0
    last_payment_date: date | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SupplierDetailRead(BaseModel):
    supplier: SupplierRead
    purchases: list["PurchaseRead"]
    payments: list["SupplierPaymentRead"]


class PurchaseReturnCreate(BaseModel):
    purchase_id: int = Field(..., gt=0)
    quantity_returned: Decimal = Field(..., gt=0, decimal_places=2)
    return_date: date | None = Field(default=None)
    reason: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=1000)


class PurchaseOrderItemCreate(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: Decimal = Field(..., gt=0, decimal_places=2)
    unit_cost_price: Decimal = Field(..., ge=0, decimal_places=2)
    unit_selling_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    expiry_date: date | None = Field(default=None)


class PurchaseCreate(BaseModel):
    product_id: int = Field(..., gt=0)
    supplier_id: int | None = Field(default=None, gt=0)
    supplier_name: str | None = Field(default=None, max_length=255)
    invoice_number: str | None = Field(default=None, max_length=100)
    quantity: Decimal = Field(..., gt=0, decimal_places=2)
    unit_cost_price: Decimal = Field(..., ge=0, decimal_places=2)
    unit_selling_price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    amount_paid: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    payment_method: str | None = Field(default=None, max_length=50)
    purchase_date: date | None = Field(default=None)
    due_date: date | None = Field(default=None)
    expiry_date: date | None = Field(default=None)
    notes: str | None = Field(default=None, max_length=1000)


class PurchaseOrderCreate(BaseModel):
    supplier_id: int | None = Field(default=None, gt=0)
    supplier_name: str | None = Field(default=None, max_length=255)
    invoice_number: str | None = Field(default=None, max_length=100)
    amount_paid: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    payment_method: str | None = Field(default=None, max_length=50)
    purchase_date: date | None = Field(default=None)
    due_date: date | None = Field(default=None)
    notes: str | None = Field(default=None, max_length=1000)
    items: list[PurchaseOrderItemCreate] = Field(..., min_length=1)


class PurchaseRead(BaseModel):
    id: int
    order_number: str | None = None
    supplier_id: int | None = None
    supplier_name: str
    product_id: int | None = None
    product_name: str
    product_sku: str
    stock_movement_id: int | None = None
    invoice_number: str | None = None
    quantity: Decimal
    unit_cost_price: Decimal
    unit_selling_price: Decimal | None = None
    total_cost: Decimal
    payment_status: Literal["unpaid", "partial", "paid"] = "unpaid"
    amount_paid: Decimal = Decimal(0)
    amount_due: Decimal = Decimal(0)
    payment_method: str | None = None
    purchase_date: date | None = None
    due_date: date | None = None
    notes: str | None = None
    created_at: datetime
    created_by_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PurchaseOrderRead(BaseModel):
    order_number: str
    supplier_id: int | None = None
    supplier_name: str
    invoice_number: str | None = None
    line_count: int
    total_cost: Decimal
    amount_paid: Decimal = Decimal(0)
    amount_due: Decimal = Decimal(0)
    payment_status: Literal["unpaid", "partial", "paid"] = "unpaid"
    payment_method: str | None = None
    purchase_date: date | None = None
    due_date: date | None = None
    notes: str | None = None
    created_at: datetime
    created_by_name: str | None = None
    items: list[PurchaseRead]


class SupplierPaymentCreate(BaseModel):
    purchase_id: int | None = Field(default=None, gt=0)
    order_number: str | None = Field(default=None, max_length=80)
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    payment_method: str = Field(..., min_length=1, max_length=50)
    payment_date: date | None = Field(default=None)
    notes: str | None = Field(default=None, max_length=1000)


class SupplierPaymentRead(BaseModel):
    id: int
    supplier_id: int | None = None
    supplier_name: str
    purchase_id: int | None = None
    order_number: str | None = None
    purchase_invoice_number: str | None = None
    product_name: str | None = None
    amount: Decimal
    payment_method: str
    payment_date: date | None = None
    notes: str | None = None
    created_at: datetime
    created_by_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PurchaseReturnRead(BaseModel):
    id: int
    supplier_id: int | None = None
    supplier_name: str
    purchase_id: int
    product_id: int | None = None
    order_number: str | None = None
    purchase_invoice_number: str | None = None
    product_name: str | None = None
    quantity_returned: Decimal
    unit_cost_price: Decimal
    total_cost_returned: Decimal
    return_date: date | None = None
    reason: str | None = None
    notes: str | None = None
    created_at: datetime
    created_by_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class StockMovementBase(BaseModel):
    change: Decimal = Field(..., decimal_places=2)
    reason: str = Field(default="adjustment", max_length=255)
    batch_number: str | None = Field(default=None, max_length=100)
    expiry_date: date | None = Field(default=None)
    unit_cost_price: Decimal | None = Field(default=None, decimal_places=2)
    unit_selling_price: Decimal | None = Field(default=None, decimal_places=2)


class StockMovementCreate(StockMovementBase):
    pass


class StockMovementRead(StockMovementBase):
    id: int
    product_id: int
    sale_id: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SaleBase(BaseModel):
    product_id: int = Field(..., gt=0)
    quantity: Decimal = Field(..., gt=0, decimal_places=2)
    sale_unit_type: str = Field(default="piece", max_length=10)
    pack_quantity: int | None = Field(default=None, ge=1)
    unit_price: Decimal = Field(..., ge=0, decimal_places=2)
    total_price: Decimal = Field(..., ge=0, decimal_places=2)
    customer_name: str | None = Field(default=None, max_length=255)
    payment_method: str = Field(default="cash", max_length=50)
    notes: str | None = Field(default=None)


class SaleCreate(SaleBase):
    client_sale_id: str | None = Field(default=None, max_length=80)
    amount_paid: Decimal | None = Field(default=None, decimal_places=2)
    partial_payment_method: str | None = Field(default=None, max_length=50)


class SaleRead(SaleBase):
    id: int
    client_sale_id: str | None = None
    amount_paid: Decimal | None = None
    partial_payment_method: str | None = None
    created_at: datetime
    created_by_name: str | None = None
    deducted_batches: list[dict[str, object]] | None = None

    model_config = ConfigDict(from_attributes=True)


# ============ Sale Return Schemas ============

class SaleReturnCreate(BaseModel):
    sale_id: int = Field(..., gt=0)
    quantity_returned: Decimal = Field(..., gt=0, decimal_places=2)
    refund_amount: Decimal = Field(..., ge=0, decimal_places=2)
    refund_method: str = Field(default="cash", max_length=50)
    reason: str | None = Field(default=None, max_length=500)
    restock: bool = Field(default=True)


class SaleReturnRead(BaseModel):
    id: int
    sale_id: int
    product_id: int
    product_name: str | None = None
    quantity_returned: Decimal
    refund_amount: Decimal
    refund_method: str
    reason: str | None
    restock: bool
    created_at: datetime
    created_by_name: str | None = None

    model_config = ConfigDict(from_attributes=True)
