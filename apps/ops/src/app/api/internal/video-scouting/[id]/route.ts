import {videoScoutingApi,canonicalRoster} from '@/lib/video-scouting-api'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const {GET,POST}=videoScoutingApi({table:'operator_video_scouting_sessions',roster:canonicalRoster})
