import type {ReportView} from './report-view';
import type {AnalysisResult} from './use-analysis-result';

/** Preserve the complete manifest: new movement metrics must not disappear from exports. */
export function completeMatchExport(payload:object, report:ReportView|null, analysis:{result:AnalysisResult|null;videoId:string|null}) {
 if (!analysis || !('result' in analysis) || !('videoId' in analysis)) throw new Error('Movement results were incomplete. Please retry the full export.');
 return {
  ...payload,
  playerPerformance: report ? {players:report.players, scopes:report.scopes} : null,
  movementAnalysis: {
   status:analysis.result ? 'available' : 'unavailable',
   videoId:analysis.videoId,
   result:analysis.result,
   definitions:{scope:'Movement totals cover analyzed video sections, independently of scouting set filters. Coverage and partial flags describe the analyzed video, not whether the upload contains the complete match.',timebase:'Source video seconds; scoutingAlignment maps original scouting timestamps to this video.'},
  },
 };
}
