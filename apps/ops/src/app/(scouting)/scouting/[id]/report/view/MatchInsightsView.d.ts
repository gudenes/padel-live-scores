import type { ReactNode } from "react";
import type { ReportView } from "@/lib/scouting/report-view";
export function MatchInsightsView(props: {
  data: ReportView;
  shared?: boolean;
  pregameMatchId?: string;
  reviewContext?: {matchId:string;manual:boolean;userId:string};
  onScopeChange: (scope:string) => void;
  reports: ReactNode;
}): ReactNode;
