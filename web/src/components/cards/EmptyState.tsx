import React from "react";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  message,
  action,
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4 text-gray-400">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-500 text-sm text-center max-w-xs mb-6">
        {message}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="text-primary-600 font-medium text-sm hover:text-primary-700"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
