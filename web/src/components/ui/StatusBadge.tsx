import React from "react";
import { getStatusColor, getStatusLabel } from "@/utils";

interface StatusBadgeProps {
  status: "valid" | "expiring" | "expired";
  size?: "sm" | "md";
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = "md",
}) => {
  const color = getStatusColor(status);
  const label = getStatusLabel(status);

  const sizeClasses =
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";

  return (
    <div
      className={`
        ${sizeClasses}
        font-semibold rounded-full
        flex items-center gap-1
        transition-all duration-200
      `}
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}40`,
      }}
    >
      <span
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </div>
  );
};
