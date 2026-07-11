import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, FileText, Bell, User } from "lucide-react";
import { motion } from "framer-motion";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  href: string;
}

const navItems: NavItem[] = [
  { id: "home", label: "Home", icon: <Home size={24} />, href: "/app" },
  {
    id: "documents",
    label: "Documents",
    icon: <FileText size={24} />,
    href: "/app/documents",
  },
  {
    id: "reminders",
    label: "Reminders",
    icon: <Bell size={24} />,
    href: "/app/reminders",
  },
  {
    id: "profile",
    label: "Profile",
    icon: <User size={24} />,
    href: "/app/profile",
  },
];

export const BottomNav: React.FC = () => {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-around">
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.href ||
              (item.href === "/app" && location.pathname.startsWith("/app"));

            return (
              <Link key={item.id} to={item.href} className="flex-1">
                <motion.div
                  className={`
                    flex flex-col items-center justify-center py-3 px-2
                    transition-colors duration-200
                    ${
                      isActive
                        ? "text-primary-600"
                        : "text-gray-400 hover:text-gray-600"
                    }
                  `}
                  whileTap={{ scale: 0.95 }}
                >
                  <motion.div
                    initial={false}
                    animate={{ scale: isActive ? 1.1 : 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    {item.icon}
                  </motion.div>
                  <span className="text-xs font-medium mt-1">{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="nav-indicator"
                      className="absolute bottom-0 h-1 bg-primary-600 rounded-t-full"
                      style={{ width: "100%", maxWidth: "60px" }}
                      transition={{ duration: 0.3 }}
                    />
                  )}
                </motion.div>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};
