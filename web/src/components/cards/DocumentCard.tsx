import React from "react";
import { Card, StatusBadge } from "@/components/ui";
import { formatDate, getDaysUntilExpiry } from "@/utils";
import type { Document } from "@/types";
import { ChevronRight, Calendar } from "lucide-react";

interface DocumentCardProps {
  document: Document;
  onClick?: (id: string) => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({
  document,
  onClick,
}) => {
  const daysUntilExpiry = getDaysUntilExpiry(document.expiryDate);

  return (
    <Card
      hoverable
      onClick={() => onClick?.(document.id)}
      className="flex items-start gap-4"
    >
      {document.imageUrl && (
        <img
          src={document.imageUrl}
          alt={document.title}
          className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <h3 className="font-semibold text-gray-900 truncate">
              {document.title}
            </h3>
            <p className="text-xs text-gray-500">{document.issuer}</p>
          </div>
          <StatusBadge status={document.status} size="sm" />
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-600 mb-3">
          <span>ID: {document.documentNumber}</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 text-gray-500">
            <Calendar className="w-4 h-4" />
            Expires {formatDate(document.expiryDate)}
          </div>
          {daysUntilExpiry <= 30 && daysUntilExpiry > 0 && (
            <span className="text-amber-600 font-medium">
              {daysUntilExpiry} days left
            </span>
          )}
        </div>
      </div>

      <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0" />
    </Card>
  );
};
