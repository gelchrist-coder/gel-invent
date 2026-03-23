import { useEffect, useState } from "react";
import CreditorList from "../components/CreditorList";
import CreditorForm from "../components/CreditorForm";
import CreditorDetails from "../components/CreditorDetails";

interface Creditor {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  total_debt: number;
  actual_debt: number;
  transaction_count: number;
  notes: string | null;
  created_at: string;
}

export default function Creditors() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedCreditor, setSelectedCreditor] = useState<Creditor | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleSelectCreditor = (creditor: Creditor) => {
    setSelectedCreditor(creditor);
  };

  const handleCloseDetails = () => {
    setSelectedCreditor(null);
  };

  const handleEdit = () => {
    setShowEditModal(true);
  };

  const handleRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleSuccess = () => {
    handleRefresh();
  };

  useEffect(() => {
    const handler = () => {
      setSelectedCreditor(null);
      setShowEditModal(false);
      setShowAddModal(false);
      handleRefresh();
    };
    window.addEventListener("activeBranchChanged", handler as EventListener);
    return () => window.removeEventListener("activeBranchChanged", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-shell">
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title" style={{ marginBottom: 8 }}>
          Customer Management
        </h1>
        <p style={{ margin: 0, color: "#5f6475", fontSize: 14 }}>
          Manage all customers and track who currently owes the business.
        </p>
      </div>

      <CreditorList
        onSelectCreditor={handleSelectCreditor}
        onAddCreditor={() => setShowAddModal(true)}
        refreshTrigger={refreshTrigger}
      />

      {/* Add Customer Modal */}
      {showAddModal && (
        <CreditorForm
          onClose={() => setShowAddModal(false)}
          onSuccess={handleSuccess}
        />
      )}

      {/* Edit Customer Modal */}
      {showEditModal && selectedCreditor && (
        <CreditorForm
          creditor={selectedCreditor}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            handleSuccess();
            setShowEditModal(false);
            setSelectedCreditor(null);
          }}
        />
      )}

      {/* Customer Details Modal */}
      {selectedCreditor && !showEditModal && (
        <CreditorDetails
          creditor={selectedCreditor}
          onClose={handleCloseDetails}
          onEdit={handleEdit}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}

