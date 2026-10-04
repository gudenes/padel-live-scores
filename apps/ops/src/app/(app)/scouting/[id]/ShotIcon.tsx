// Icons from Lucide (ISC license): https://lucide.dev/license
const icons={
  overhead: (<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24" aria-hidden="true"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth="2"
  strokeLinecap="round"
  strokeLinejoin="round"
>
  <path d="m7 7 10 10" />
  <path d="M17 7v10H7" />
</svg>
),
  net: (<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24" aria-hidden="true"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth="2"
  strokeLinecap="round"
  strokeLinejoin="round"
>
  <path d="m18 8 4 4-4 4" />
  <path d="M2 12h20" />
  <path d="m6 8-4 4 4 4" />
</svg>
),
  defence: (<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24" aria-hidden="true"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth="2"
  strokeLinecap="round"
  strokeLinejoin="round"
>
  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
</svg>
),
  serve: (<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24" aria-hidden="true"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  strokeWidth="2"
  strokeLinecap="round"
  strokeLinejoin="round"
>
  <path d="M7 7h10v10" />
  <path d="M7 17 17 7" />
</svg>
),
}
export default function ShotIcon({kind}:{kind:keyof typeof icons}){return icons[kind]}
