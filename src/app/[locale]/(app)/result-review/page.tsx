import {notFound} from 'next/navigation'
import ResultReview from '@/components/play-results/ResultReview'
export default function Page(){if(process.env.NODE_ENV==='production')notFound();return <ResultReview/>}
