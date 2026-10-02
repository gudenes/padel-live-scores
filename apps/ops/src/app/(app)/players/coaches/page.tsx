// /players/coaches has no page of its own — the list lives in the Players hub.
import { redirect } from 'next/navigation'

export default function Page() {
  redirect('/players?view=coaches')
}
