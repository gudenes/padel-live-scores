// apps/ops/src/app/(app)/system/architecture/page.tsx
import ArchitectureTab from './_components/ArchitectureTab'

export const metadata = { title: 'Architecture · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function ArchitecturePage() {
  return <ArchitectureTab />
}
