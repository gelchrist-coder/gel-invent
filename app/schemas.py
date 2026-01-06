from datetime import datetime, date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ProductBase(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1024)
    unit: str = Field(default="unit", min_length=1, max_length=32)
    pack_size: int | None = Field(default=None)
    category: str | None = Field(default=None, max_length=100)
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
