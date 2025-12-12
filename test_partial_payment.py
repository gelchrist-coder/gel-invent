import requests
import json

BASE_URL = "http://localhost:8000"

def test_partial_payment():
    # First, get products to find a product_id
    products_response = requests.get(f"{BASE_URL}/products")
    products = products_response.json()
    
    if not products:
        print("❌ No products found. Please add a product first.")
        return
    
    product = products[0]
    print(f"✅ Using product: {product['name']} (ID: {product['id']})")
    
    # Create a partial payment sale
    # Example: Total GHS 100, customer pays GHS 60 cash, GHS 40 on credit
    sale_data = {
        "product_id": product['id'],
        "quantity": 2,
        "unit_price": 50.00,
        "total_price": 100.00,
        "customer_name": "Test Customer",
        "payment_method": "partial",
        "amount_paid": 60.00,
        "partial_payment_method": "cash",
        "notes": "Test partial payment"
    }
    
    print("\n📝 Creating partial payment sale:")
    print(f"   Total: GHS {sale_data['total_price']}")
    print(f"   Paid: GHS {sale_data['amount_paid']} ({sale_data['partial_payment_method']})")
    print(f"   Credit: GHS {sale_data['total_price'] - sale_data['amount_paid']}")
    
    response = requests.post(f"{BASE_URL}/sales", json=sale_data)
    
    if response.status_code == 201:
        sale = response.json()
        print(f"\n✅ Sale created successfully (ID: {sale['id']})")
        
        # Check if creditor was created/updated
        creditors_response = requests.get(f"{BASE_URL}/creditors")
        creditors = creditors_response.json()
        
        test_creditor = next((c for c in creditors if c['name'] == "Test Customer"), None)
        if test_creditor:
            print(f"\n✅ Creditor updated:")
            print(f"   Name: {test_creditor['name']}")
            print(f"   Total Debt: GHS {test_creditor['total_debt']}")
            
            # Check credit transaction
            transactions_response = requests.get(f"{BASE_URL}/creditors/{test_creditor['id']}")
            creditor_details = transactions_response.json()
            
            if creditor_details.get('transactions'):
                latest_transaction = creditor_details['transactions'][0]
                print(f"\n✅ Credit transaction created:")
                print(f"   Amount: GHS {latest_transaction['amount']}")
                print(f"   Type: {latest_transaction['transaction_type']}")
                print(f"   Notes: {latest_transaction['notes']}")
        else:
            print("⚠️  Creditor not found")
    else:
        print(f"\n❌ Failed to create sale: {response.status_code}")
        print(response.json())

if __name__ == "__main__":
    test_partial_payment()
