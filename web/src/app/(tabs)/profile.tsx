import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Header, Button, SectionHeader } from "@/components/ui";
import { ProfileRow } from "@/components/cards";
import { MOCK_USER } from "@/constants";
import {
  LogOut,
  Lock,
  Bell,
  HelpCircle,
  CreditCard,
  ShieldCheck,
} from "lucide-react";

export const Profile: React.FC = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    // TODO: Implement logout logic
    navigate("/login");
  };

  const securityLevelColor = {
    basic: "text-gray-500",
    standard: "text-amber-600",
    premium: "text-green-600",
  };

  return (
    <div className="p-4 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Header title="Profile" />
      </motion.div>

      {/* User Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-gradient-to-br from-primary-50 to-primary-100 rounded-2xl p-6 text-center"
      >
        <img
          src={MOCK_USER.avatar}
          alt={MOCK_USER.name}
          className="w-16 h-16 rounded-full mx-auto mb-4 border-4 border-white"
        />
        <h2 className="text-2xl font-bold text-gray-900">{MOCK_USER.name}</h2>
        <p className="text-gray-600 text-sm mt-1">{MOCK_USER.email}</p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <ShieldCheck
            className={`w-5 h-5 ${securityLevelColor[MOCK_USER.securityLevel]}`}
          />
          <span className="text-sm font-semibold text-gray-700">
            {MOCK_USER.securityLevel.charAt(0).toUpperCase() +
              MOCK_USER.securityLevel.slice(1)}{" "}
            Plan
          </span>
        </div>
      </motion.div>

      {/* Account Stats */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-2 gap-3"
      >
        <div className="bg-white rounded-2xl p-4 text-center shadow-card">
          <p className="text-gray-500 text-xs font-medium">Documents</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">
            {MOCK_USER.documentCount}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-4 text-center shadow-card">
          <p className="text-gray-500 text-xs font-medium">Expiring Soon</p>
          <p className="text-2xl font-bold text-amber-600 mt-2">
            {MOCK_USER.expiringCount}
          </p>
        </div>
      </motion.div>

      {/* Settings Section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        <SectionHeader title="Settings" />
        <div className="bg-white rounded-2xl overflow-hidden shadow-card divide-y divide-gray-100">
          <ProfileRow
            label="Account Security"
            value="Manage password and authentication"
            icon={<Lock className="w-5 h-5" />}
            onClick={() => {}}
          />
          <ProfileRow
            label="Notifications"
            value="Email and push notifications"
            icon={<Bell className="w-5 h-5" />}
            onClick={() => {}}
          />
          <ProfileRow
            label="Subscription"
            value="Manage your plan"
            icon={<CreditCard className="w-5 h-5" />}
            onClick={() => {}}
          />
          <ProfileRow
            label="Help & Support"
            value="Contact our support team"
            icon={<HelpCircle className="w-5 h-5" />}
            onClick={() => {}}
          />
        </div>
      </motion.div>

      {/* Logout Button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button
          variant="danger"
          fullWidth
          icon={<LogOut className="w-4 h-4" />}
          onClick={handleLogout}
        >
          Sign Out
        </Button>
      </motion.div>

      {/* Version Info */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center text-gray-400 text-xs"
      >
        DocuGuard v1.0.0
      </motion.p>
    </div>
  );
};
