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
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>
        Creditors Management
      </h1>

      <CreditorList
        onSelectCreditor={handleSelectCreditor}
        onAddCreditor={() => setShowAddModal(true)}
        refreshTrigger={refreshTrigger}
      />

      {/* Add Creditor Modal */}
      {showAddModal && (
        <CreditorForm
          onClose={() => setShowAddModal(false)}
          onSuccess={handleSuccess}
        />
      )}

      {/* Edit Creditor Modal */}
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

      {/* Creditor Details Modal */}
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

