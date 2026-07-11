import React from "react";
import { motion } from "framer-motion";

interface AppShellProps {
  children: React.ReactNode;
  bottomNav?: React.ReactNode;
  showBottomNav?: boolean;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  bottomNav,
  showBottomNav = true,
}) => {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Mobile app container */}
      <div className="max-w-md mx-auto w-full flex flex-col flex-1">
        {/* Main content area */}
        <main className="flex-1 overflow-y-auto pb-20">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {children}
          </motion.div>
        </main>

        {/* Bottom navigation */}
        {showBottomNav && bottomNav}
      </div>
    </div>
  );
};
