import React from "react";
import { Link } from "react-router-dom";

interface QuickActionsProps {
  onScanDocument?: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({
  onScanDocument,
}) => {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Link
        to="/app/add-document"
        className="flex items-center justify-center gap-2 p-4 rounded-2xl bg-primary-600 text-white hover:bg-primary-700 transition-colors font-semibold"
      >
        <span>+</span>
        Add Document
      </Link>
      <button
        onClick={onScanDocument}
        className="flex items-center justify-center gap-2 p-4 rounded-2xl bg-gray-100 text-gray-900 hover:bg-gray-200 transition-colors font-semibold"
      >
        <span>📱</span>
        Scan
      </button>
    </div>
  );
};
