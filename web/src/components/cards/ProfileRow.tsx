import React from "react";
import { ChevronRight } from "lucide-react";

interface ProfileRowProps {
  label: string;
  value?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "danger";
}

export const ProfileRow: React.FC<ProfileRowProps> = ({
  label,
  value,
  icon,
  action,
  onClick,
  variant = "default",
}) => {
  const bgColor = variant === "danger" ? "hover:bg-red-50" : "hover:bg-gray-50";
  const textColor = variant === "danger" ? "text-red-600" : "text-gray-900";

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-4 py-4 border-b border-gray-100 transition-colors ${bgColor} text-left`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {icon && <div className={`flex-shrink-0 ${textColor}`}>{icon}</div>}
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm ${textColor}`}>{label}</p>
          {value && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{value}</p>
          )}
        </div>
      </div>
      {action ? (
        action
      ) : (
        <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
      )}
    </button>
  );
};
