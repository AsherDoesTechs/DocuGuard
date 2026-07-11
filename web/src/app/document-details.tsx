import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronLeft, Calendar, Hash } from "lucide-react";
import { Button, Card, StatusBadge } from "@/components/ui";
import { MOCK_DOCUMENTS } from "@/constants";
import { formatDate, getDaysUntilExpiry } from "@/utils";

export const DocumentDetails: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const document = MOCK_DOCUMENTS.find((d) => d.id === id);

  if (!document) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Document not found</p>
      </div>
    );
  }

  const daysUntilExpiry = getDaysUntilExpiry(document.expiryDate);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
        <div className="p-4 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="text-primary-600 hover:text-primary-700"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg font-bold text-gray-900 flex-1 text-center">
            Document Details
          </h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 space-y-4 pb-20"
      >
        {/* Image */}
        {document.imageUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl overflow-hidden bg-gray-200"
          >
            <img
              src={document.imageUrl}
              alt={document.title}
              className="w-full h-48 object-cover"
            />
          </motion.div>
        )}

        {/* Title and Status */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {document.title}
              </h2>
              <p className="text-gray-600 text-sm mt-1">{document.issuer}</p>
            </div>
            <StatusBadge status={document.status} />
          </div>
        </Card>

        {/* Document Details */}
        <Card className="space-y-4">
          <div className="flex items-start gap-3">
            <Hash className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 font-medium">
                Document Number
              </p>
              <p className="text-gray-900 font-mono text-sm mt-1">
                {document.documentNumber}
              </p>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-gray-500 font-medium">Issue Date</p>
                <p className="text-gray-900 text-sm mt-1">
                  {formatDate(document.issueDate)}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-gray-500 font-medium">Expiry Date</p>
                <p className="text-gray-900 text-sm mt-1">
                  {formatDate(document.expiryDate)}
                </p>
                {daysUntilExpiry > 0 && daysUntilExpiry <= 30 && (
                  <p className="text-amber-600 text-xs mt-2">
                    ⚠ Expires in {daysUntilExpiry} days
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Notes */}
        {document.notes && (
          <Card>
            <p className="text-xs text-gray-500 font-medium mb-2">Notes</p>
            <p className="text-gray-700 text-sm">{document.notes}</p>
          </Card>
        )}

        {/* Actions */}
        <div className="space-y-3 pt-4">
          <Button
            fullWidth
            onClick={() => navigate(`/app/edit-document/${document.id}`)}
          >
            Edit Document
          </Button>
          <Button variant="secondary" fullWidth>
            Download
          </Button>
          <Button variant="danger" fullWidth>
            Delete Document
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
