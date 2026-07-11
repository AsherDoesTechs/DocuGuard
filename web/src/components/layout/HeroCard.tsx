import React from "react";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui";
import { calculateDashboardSummary } from "@/utils";
import { MOCK_DOCUMENTS } from "@/constants";

export const HeroCard: React.FC = () => {
  const summary = calculateDashboardSummary(MOCK_DOCUMENTS);
  const safetyScore = Math.max(
    0,
    100 - (summary.expiringDocuments + summary.expiredDocuments) * 10,
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="bg-gradient-to-br from-primary-600 to-primary-700 text-white p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-white/80 text-sm font-medium">Safety Score</p>
            <h3 className="text-4xl font-bold mt-1">{safetyScore}%</h3>
          </div>
          <div className="bg-white/20 backdrop-blur rounded-full p-3">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/20">
          <div>
            <p className="text-white/60 text-xs">
              {summary.validDocuments} Valid
            </p>
            <p className="font-semibold text-lg">{summary.totalDocuments}</p>
          </div>
          <div>
            <p className="text-white/60 text-xs">
              {summary.expiringDocuments} Expiring
            </p>
            <p className="font-semibold text-lg">
              {summary.expiredDocuments} Expired
            </p>
          </div>
          <div>
            <p className="text-white/60 text-xs">Reminders</p>
            <p className="font-semibold text-lg">{summary.pendingReminders}</p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
};
