import React from "react";
import { Card } from "@/components/ui";
import type { Reminder } from "@/types";
import { formatDate } from "@/utils";
import { AlertCircle, CheckCircle, Info } from "lucide-react";

interface ReminderItemProps {
  reminder: Reminder;
  onClick?: (id: string) => void;
  onMarkAsRead?: (id: string) => void;
}

export const ReminderItem: React.FC<ReminderItemProps> = ({
  reminder,
  onClick,
  onMarkAsRead,
}) => {
  const severityIcons = {
    urgent: <AlertCircle className="w-5 h-5 text-accent-red" />,
    warning: <AlertCircle className="w-5 h-5 text-accent-amber" />,
    info: <Info className="w-5 h-5 text-primary-600" />,
  };

  const severityColors = {
    urgent: "border-l-4 border-accent-red bg-red-50",
    warning: "border-l-4 border-accent-amber bg-amber-50",
    info: "border-l-4 border-primary-600 bg-blue-50",
  };

  return (
    <Card
      className={`flex items-start gap-3 cursor-pointer ${severityColors[reminder.severity]} p-4`}
      onClick={() => onClick?.(reminder.id)}
    >
      <div className="flex-shrink-0 mt-0.5">
        {reminder.isRead ? (
          <CheckCircle className="w-5 h-5 text-gray-400" />
        ) : (
          severityIcons[reminder.severity]
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3
          className={`font-semibold text-sm ${reminder.isRead ? "text-gray-500" : "text-gray-900"}`}
        >
          {reminder.title}
        </h3>
        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
          {reminder.message}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          Due: {formatDate(reminder.dueDate)}
        </p>
      </div>

      {!reminder.isRead && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMarkAsRead?.(reminder.id);
          }}
          className="flex-shrink-0 text-primary-600 hover:text-primary-700 font-medium text-xs"
        >
          Mark read
        </button>
      )}
    </Card>
  );
};
