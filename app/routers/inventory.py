from datetime import datetime, timedelta
from decimal import Decimal
from io import BytesIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, and_, or_, case
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product, StockMovement, Sale, User, SystemSettings
from ..auth import get_current_active_user
from app.utils.tenant import get_tenant_user_ids
from app.utils.branch import get_active_branch_id
from app.utils.movement_reasons import classify_movement
from app.utils.expiry import get_batch_balances, writeoff_expired_batches

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _get_tenant_owner_id(user: User) -> int:
    if user.role == "Admin":
        return user.id
    return user.created_by or user.id


def _get_or_create_settings(db: Session, owner_user_id: int) -> SystemSettings:
    settings = db.query(SystemSettings).filter(SystemSettings.owner_user_id == owner_user_id).first()
    if settings:
        return settings
    settings = SystemSettings(owner_user_id=owner_user_id)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


@router.get("/analytics")
def get_inventory_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
):
    """
    Get comprehensive inventory analytics including:
    - Stock levels by location
    - Low stock alerts
    - Expiring products
    - Movement summary
    - Stock value
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    owner_user_id = _get_tenant_owner_id(current_user)
    settings = _get_or_create_settings(db, owner_user_id)
    low_stock_threshold = settings.low_stock_threshold
    expiry_warning_days = settings.expiry_warning_days

    # Auto-writeoff expired batches so analytics reflect real stock.
    writeoff_expired_batches(
        db=db,
        actor_user_id=current_user.id,
        tenant_user_ids=tenant_user_ids,
        branch_id=active_branch_id,
        product_id=None,
    )
    db.commit()
    
    # Get all products with their stock levels
    products = db.scalars(
        select(Product).where(
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    ).all()
    
    # Calculate stock for each product
    low_stock_products = []
    expiring_batches = []
    total_stock_value = Decimal(0)
    total_stock_left = Decimal(0)
    
    today = datetime.now().date()
    
    for product in products:
        movements = db.scalars(
            select(StockMovement)
            .where(
                and_(
                    StockMovement.product_id == product.id,
                    StockMovement.user_id.in_(tenant_user_ids),
                    StockMovement.branch_id == active_branch_id,
                )
            )
            .order_by(StockMovement.created_at.desc())
        ).all()
        
        # Calculate total stock
        total_stock_raw = sum(m.change for m in movements)
        total_stock = total_stock_raw if total_stock_raw > 0 else Decimal(0)
        total_stock_left += total_stock
        
        # Stock value (prefer per-batch unit cost; fallback to product cost)
        if total_stock > 0:
            product_cost = Decimal(product.cost_price) if product.cost_price is not None else None
            balances = get_batch_balances(
                db=db,
                tenant_user_ids=tenant_user_ids,
                branch_id=active_branch_id,
                product_id=product.id,
                include_null_expiry=True,
            )
            tracked_total = sum((b.balance for b in balances), Decimal(0))

            batch_numbers = sorted({b.batch_number for b in balances if b.batch_number})
            unit_cost_by_batch: dict[str, Decimal | None] = {}
            if batch_numbers:
                rows = db.execute(
                    select(
                        StockMovement.batch_number,
                        StockMovement.unit_cost_price,
                        StockMovement.created_at,
                    )
                    .where(
                        StockMovement.product_id == product.id,
                        StockMovement.branch_id == active_branch_id,
                        StockMovement.user_id.in_(tenant_user_ids),
                        StockMovement.batch_number.in_(batch_numbers),
                        StockMovement.change > 0,
                    )
                    .order_by(StockMovement.batch_number.asc(), StockMovement.created_at.desc())
                ).all()
                for bn, unit_cost, _created_at in rows:
                    if bn is None:
                        continue
                    bn_str = str(bn)
                    if bn_str not in unit_cost_by_batch:
                        unit_cost_by_batch[bn_str] = unit_cost

            value = Decimal(0)
            for b in balances:
                if b.balance <= 0:
                    continue
                unit_cost = unit_cost_by_batch.get(b.batch_number)
                if unit_cost is None:
                    unit_cost = product_cost
                if unit_cost is None:
                    continue
                value += b.balance * Decimal(unit_cost)

            untracked = total_stock - tracked_total
            if untracked > 0 and product_cost is not None:
                value += untracked * product_cost
            total_stock_value += value
        
        # Low stock check
        if total_stock < low_stock_threshold:
            low_stock_products.append({
                "id": product.id,
                "name": product.name,
                "sku": product.sku,
                "current_stock": float(total_stock),
                "threshold": low_stock_threshold,
                "category": product.category,
            })
        
        # Expiring batches (true remaining per batch)
        if total_stock > 0:
            balances = get_batch_balances(
                db=db,
                tenant_user_ids=tenant_user_ids,
                branch_id=active_branch_id,
                product_id=product.id,
                include_null_expiry=False,
            )
            for b in balances:
                if b.balance <= 0 or b.expiry_date is None:
                    continue
                days_to_expiry = (b.expiry_date - today).days
                if days_to_expiry <= expiry_warning_days:
                    expiring_batches.append(
                        {
                            "product_id": product.id,
                            "product_name": product.name,
                            "sku": product.sku,
                            "batch_number": b.batch_number,
                            "quantity": float(b.balance),
                            "expiry_date": b.expiry_date.isoformat(),
                            "days_to_expiry": days_to_expiry,
                            "status": "expired"
                            if days_to_expiry < 0
                            else "expiring_soon"
                            if days_to_expiry <= 7
                            else "expiring_30"
                            if days_to_expiry <= 30
                            else "expiring_90",
                        }
                    )
    
    # Movement summary (last 30 days)
    thirty_days_ago = datetime.now() - timedelta(days=30)
    recent_movements = db.scalars(
        select(StockMovement)
        .where(
            and_(
                StockMovement.created_at >= thirty_days_ago,
                StockMovement.user_id.in_(tenant_user_ids),
                or_(
                    StockMovement.branch_id == active_branch_id,
                    StockMovement.branch_id.is_(None),
                ),
            )
        )
    ).all()
    
    movement_summary = {
        "stock_in": 0,
        "stock_out": 0,
    }
    
    for movement in recent_movements:
        change = float(movement.change)
        if change > 0:
            movement_summary["stock_in"] += change
        else:
            movement_summary["stock_out"] += abs(change)

    # Owner-only movement totals (all-time) for this branch.
    owner_in_out = db.execute(
        select(
            func.coalesce(
                func.sum(case((StockMovement.change > 0, StockMovement.change), else_=0)),
                0,
            ).label("stock_in"),
            func.coalesce(
                func.sum(case((StockMovement.change < 0, -StockMovement.change), else_=0)),
                0,
            ).label("stock_out"),
        ).where(
            StockMovement.user_id == owner_user_id,
            StockMovement.branch_id == active_branch_id,
        )
    ).one()
    
    return {
        "stock_by_location": [],
        "low_stock_alerts": low_stock_products,
        "expiring_products": sorted(expiring_batches, key=lambda x: x["days_to_expiry"]),
        "movement_summary": movement_summary,
        "total_stock_left": float(total_stock_left),
        "owner_movement_totals": {
            "stock_in": float(owner_in_out.stock_in),
            "stock_out": float(owner_in_out.stock_out),
        },
        "total_stock_value": float(total_stock_value),
        "total_products": len(products),
    }


@router.get("/movements")
def get_all_movements(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
    reason: str | None = Query(None),
    days: int = Query(30, ge=1, le=365),
):
    """
    Get all stock movements with optional filters.
    """
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    query = select(StockMovement).join(Product)
    
    # Filter by date and user
    since_date = datetime.now() - timedelta(days=days)
    query = query.where(
        and_(
            StockMovement.created_at >= since_date,
            StockMovement.user_id.in_(tenant_user_ids),
            StockMovement.branch_id == active_branch_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    )
    
    # Filter by reason
    if reason:
        query = query.where(StockMovement.reason == reason)
    
    query = query.order_by(StockMovement.created_at.desc())
    
    movements = db.scalars(query).all()
    
    result = []
    for movement in movements:
        product = db.scalar(
            select(Product).where(
                and_(
                    Product.id == movement.product_id,
                    Product.user_id.in_(tenant_user_ids),
                    Product.branch_id == active_branch_id,
                )
            )
        )
        result.append({
            "id": movement.id,
            "product_id": movement.product_id,
            "product_name": product.name if product else "Unknown",
            "product_sku": product.sku if product else "N/A",
            "change": float(movement.change),
            "reason": movement.reason,
            "batch_number": movement.batch_number,
            "expiry_date": movement.expiry_date.isoformat() if movement.expiry_date else None,
            "created_at": movement.created_at.isoformat(),
        })
    
    return result


@router.get("/movements/export-pdf")
def export_movements_pdf(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    active_branch_id: int = Depends(get_active_branch_id),
    days: int = Query(30, ge=1, le=365),
    movement_type: str | None = Query(None, description="Filter by: stock_in, stock_out, sale, all"),
):
    """
    Export stock movements to PDF.
    
    Movement types:
    - stock_in: Purchases, restocks, returns (positive movements)
    - stock_out: Damaged, expired, write-offs (negative non-sale movements)
    - sale: Sales transactions
    - all: All movements
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    
    tenant_user_ids = get_tenant_user_ids(current_user, db)
    
    # Fetch movements
    since_date = datetime.now() - timedelta(days=days)
    query = select(StockMovement).join(Product).where(
        and_(
            StockMovement.created_at >= since_date,
            StockMovement.user_id.in_(tenant_user_ids),
            StockMovement.branch_id == active_branch_id,
            Product.user_id.in_(tenant_user_ids),
            Product.branch_id == active_branch_id,
        )
    ).order_by(StockMovement.created_at.desc())
    
    movements = db.scalars(query).all()
    
    # Filter by movement type
    filtered_movements = []
    for movement in movements:
        product = db.scalar(
            select(Product).where(
                and_(
                    Product.id == movement.product_id,
                    Product.user_id.in_(tenant_user_ids),
                    Product.branch_id == active_branch_id,
                )
            )
        )
        
        # Classify movement
        classification = classify_movement(movement.reason, movement.change)
        
        # Determine if it matches filter
        if movement_type and movement_type != "all":
            if movement_type == "stock_in" and classification != "stock_in":
                continue
            if movement_type == "stock_out" and classification not in ("stock_out", "adjustments"):
                continue
            if movement_type == "sale" and classification != "sales":
                continue
        
        filtered_movements.append({
            "date": movement.created_at.strftime("%d %b %Y %H:%M"),
            "product_name": product.name if product else "Unknown",
            "product_sku": product.sku if product else "N/A",
            "change": float(movement.change),
            "reason": movement.reason,
            "batch_number": movement.batch_number or "-",
            "type": "Stock In" if movement.change > 0 else ("Sale" if classification == "sales" else "Stock Out"),
        })
    
    # Generate PDF
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=30,
        leftMargin=30,
        topMargin=30,
        bottomMargin=30,
    )
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=20,
        alignment=1,  # Center
    )
    
    elements = []
    
    # Title
    type_label = {
        "stock_in": "Stock In (Purchases)",
        "stock_out": "Stock Out",
        "sale": "Sales",
        None: "All Movements",
        "all": "All Movements",
    }.get(movement_type, "All Movements")
    
    title = Paragraph(f"Stock Movement Report - {type_label}", title_style)
    elements.append(title)
    
    # Subtitle with date range
    subtitle_style = ParagraphStyle(
        'Subtitle',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.gray,
        alignment=1,
        spaceAfter=20,
    )
    subtitle = Paragraph(
        f"Generated on {datetime.now().strftime('%d %b %Y %H:%M')} | Last {days} days | {len(filtered_movements)} records",
        subtitle_style,
    )
    elements.append(subtitle)
    elements.append(Spacer(1, 0.2 * inch))
    
    # Summary statistics
    total_in = sum(m["change"] for m in filtered_movements if m["change"] > 0)
    total_out = abs(sum(m["change"] for m in filtered_movements if m["change"] < 0))
    
    summary_data = [
        ["Summary", ""],
        ["Total Stock In", f"+{total_in:.2f} units"],
        ["Total Stock Out", f"-{total_out:.2f} units"],
        ["Net Change", f"{total_in - total_out:+.2f} units"],
    ]
    
    summary_table = Table(summary_data, colWidths=[2 * inch, 2 * inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor("#f9fafb")),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 0.3 * inch))
    
    # Movement table
    if filtered_movements:
        header = ["Date", "Product", "SKU", "Change", "Type", "Reason", "Batch"]
        data = [header]
        
        for m in filtered_movements:
            change_str = f"+{m['change']:.2f}" if m["change"] > 0 else f"{m['change']:.2f}"
            data.append([
                m["date"],
                m["product_name"][:25] + "..." if len(m["product_name"]) > 25 else m["product_name"],
                m["product_sku"],
                change_str,
                m["type"],
                m["reason"],
                m["batch_number"],
            ])
        
        col_widths = [1.2 * inch, 2.0 * inch, 1.0 * inch, 0.8 * inch, 0.9 * inch, 1.2 * inch, 1.1 * inch]
        table = Table(data, colWidths=col_widths, repeatRows=1)
        
        table.setStyle(TableStyle([
            # Header
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#1f2937")),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('TOPPADDING', (0, 0), (-1, 0), 10),
            # Body
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('ALIGN', (3, 1), (3, -1), 'RIGHT'),  # Change column
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]))
        
        elements.append(table)
    else:
        no_data = Paragraph("No movements found for the selected criteria.", styles['Normal'])
        elements.append(no_data)
    
    doc.build(elements)
    buffer.seek(0)
    
    filename = f"stock_movements_{movement_type or 'all'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
