/** Registration on the existing 1024 × 1536 artwork; no identity is redrawn. */
export const AVATAR_HEAD_PATH='M0 0H1024V520H698Q673 566 625 592Q574 621 520 601Q455 585 407 550L388 520H0Z'
// Rear hair is outside the face/ear envelope. Its pixels remain behind headwear.
export const AVATAR_FACE_PATH='M365 285Q380 230 520 235Q672 205 710 285L740 445Q710 555 625 592Q574 621 520 601Q435 578 390 520L335 425Z'
// Crown envelopes retain hair in the adjustment opening while hiding protruding
// top hair. Hair below the temples (including ponytails) remains untouched.
export const CAP_HAIR_ENVELOPES={
 backwards:'M0 340H332L334 240Q336 162 425 132Q510 98 585 121Q659 129 683 216L702 300H1024V1536H0Z',
 forward:'M0 355H340L351 257Q363 159 493 143Q617 120 680 223L712 310H1024V1536H0Z',
} as const
export function capHairEnvelope(hatId:string|undefined){
 if(hatId==='hat-backwards')return CAP_HAIR_ENVELOPES.backwards
 if(hatId==='hat-club'||hatId==='hat-champion')return CAP_HAIR_ENVELOPES.forward
 return null // Visors and bandanas leave the crown open.
}

// Preset heads end above the original shirt collar; generated heads retain the
// deeper jaw boundary used by the photo pipeline.
export const PRESET_HEAD_PATH='M0 0H1024V510H714Q669 567 598 574Q540 584 483 558Q433 541 406 510H0Z'
