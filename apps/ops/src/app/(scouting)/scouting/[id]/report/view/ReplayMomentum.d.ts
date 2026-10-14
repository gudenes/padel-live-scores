import type {ReportView} from '@/lib/scouting/report-view';
import type {replayPoints} from '@/lib/scouting/video-review';
type Points=ReturnType<typeof replayPoints>;
export default function ReplayMomentum(props:{overview?:boolean;playerFiltered:boolean;points:Points;players:ReportView['players'];sets:ReportView['sets'];filtered:Points;selected:string|undefined;onChoose:(id:string)=>void}):React.JSX.Element;
