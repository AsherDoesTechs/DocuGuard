import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { Header, SectionHeader, Button } from "@/components/ui";
import { DocumentCard, StatCard, ReminderItem } from "@/components/cards";
import { HeroCard, QuickActions } from "@/components/layout";
import { MOCK_DOCUMENTS, MOCK_REMINDERS, MOCK_USER } from "@/constants";
import { calculateDashboardSummary } from "@/utils";

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const summary = calculateDashboardSummary(MOCK_DOCUMENTS);
  const recentDocuments = MOCK_DOCUMENTS.slice(0, 3);
  const urgentReminders = MOCK_REMINDERS.filter(
    (r) => r.severity === "urgent" || r.severity === "warning",
  ).slice(0, 2);

  return (
    <div className="p-4 space-y-6">
      {/* Welcome Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-2"
      >
        <p className="text-sm text-gray-500">
          Good afternoon, {MOCK_USER.name.split(" ")[0]}
        </p>
        <Header title="Your Dashboard" />
      </motion.div>

      {/* Hero Card */}
      <HeroCard />

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <QuickActions />
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="grid grid-cols-2 gap-3"
      >
        <StatCard
          label="Valid Docs"
          value={summary.validDocuments}
          icon={<TrendingUp size={20} />}
          color="success"
        />
        <StatCard
          label="Action Needed"
          value={summary.expiringDocuments + summary.expiredDocuments}
          icon={<AlertTriangle size={20} />}
          color={
            summary.expiringDocuments + summary.expiredDocuments > 0
              ? "warning"
              : "primary"
          }
        />
      </motion.div>

      {/* Recent Documents */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div className="flex items-center justify-between">
          <SectionHeader
            title="Recent Documents"
            subtitle={`${summary.totalDocuments} total`}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/app/documents")}
          >
            View All
          </Button>
        </div>
        <div className="space-y-2">
          {recentDocuments.map((doc, idx) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 + idx * 0.05 }}
              onClick={() => navigate(`/app/documents/${doc.id}`)}
            >
              <DocumentCard document={doc} />
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Urgent Reminders */}
      {urgentReminders.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <SectionHeader title="Action Required" subtitle="Urgent reminders" />
          <div className="space-y-2">
            {urgentReminders.map((reminder, idx) => (
              <motion.div
                key={reminder.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 + idx * 0.05 }}
              >
                <ReminderItem reminder={reminder} />
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};
