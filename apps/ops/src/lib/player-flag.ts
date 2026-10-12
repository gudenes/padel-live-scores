const available=new Set(["ad", "ae", "al", "am", "ar", "at", "au", "az", "ba", "be", "bg", "bh", "bl", "bo", "br", "ca", "cd", "ch", "ci", "cl", "cn", "co", "cr", "cu", "cy", "cz", "de", "dk", "do", "dz", "ec", "ee", "eg", "es", "fi", "fr", "gb", "ge", "gh", "gr", "hk", "hn", "hr", "hu", "id", "ie", "il", "in", "iq", "ir", "is", "it", "jm", "jo", "jp", "ke", "kg", "kr", "kw", "kz", "lb", "lt", "lu", "lv", "ma", "mc", "md", "mg", "ml", "mt", "mx", "my", "ne", "nl", "no", "nz", "om", "pa", "pe", "ph", "pk", "pl", "pt", "py", "qa", "ro", "rs", "ru", "sa", "se", "sg", "si", "sk", "sn", "th", "tn", "tr", "tw", "ua", "us", "uy", "uz", "ve", "vn", "xk", "za"])
export function playerFlag(country?:string|null){
 const code=country?.toLowerCase();const canonical=code==='uk'?'gb':code
 return canonical&&available.has(canonical)?`/flags/${canonical}.png`:null
}
