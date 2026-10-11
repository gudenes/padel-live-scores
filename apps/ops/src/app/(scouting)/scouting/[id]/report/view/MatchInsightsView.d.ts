import type { ReactNode } from "react";
import type { ReportView } from "@/lib/scouting/report-view";
export function MatchInsightsView(props: {
  data: ReportView;
  onExport: () => void;
  reports: ReactNode;
}): ReactNode;
