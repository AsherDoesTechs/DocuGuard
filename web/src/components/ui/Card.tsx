import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  hoverable?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, hoverable = false, className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`
          bg-white rounded-2xl shadow-card p-5
          ${hoverable ? "transition-all duration-200 hover:shadow-lg hover:-translate-y-1 cursor-pointer" : ""}
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Card.displayName = "Card";
